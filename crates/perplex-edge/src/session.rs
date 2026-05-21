//! Session-key verification chain.
//!
//! The frontend mints a short-lived session key on-chain via `SessionKey.sol`. Each order it
//! submits to the edge is signed by that session key — not by the wallet — so users do not
//! see a popup per order.
//!
//! Edge verification chain:
//!   1. Recover the signer EOA from `order.signature` over the EIP-712 order digest.
//!   2. Look up the recovered address in the `SessionRegistry` (on-chain reader). Reject if the
//!      session is missing, revoked, expired, or owned by a different address than the JWT
//!      caller.
//!   3. Debit `notionalUsdc` cumulatively. Reject if the new total crosses `maxNotionalUsdc`.
//!
//! The actual on-chain `consume` write call is wired via the `SessionRegistry` impl. Tests use
//! an in-memory registry that mirrors `SessionKey.sol`'s semantics 1-to-1.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use parking_lot::RwLock;
use sha3::{Digest, Keccak256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("bad signature encoding: {0}")]
    BadEncoding(String),
    #[error("signature recovery failed")]
    RecoverFailed,
    #[error("session not registered")]
    NotRegistered,
    #[error("session revoked or inactive")]
    Inactive,
    #[error("session expired")]
    Expired,
    #[error("owner mismatch: signed by {recovered} but JWT caller is {claimed}")]
    OwnerMismatch { recovered: String, claimed: String },
    #[error("notional cap exceeded: {spent} + {amount} > {cap}")]
    CapExceeded {
        spent: u128,
        amount: u128,
        cap: u128,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub owner: String,        // EIP-55 checksummed address
    pub expires_at_secs: u64, // unix seconds
    pub max_notional_usdc: u128,
    pub spent_notional_usdc: u128,
    pub active: bool,
}

#[async_trait]
pub trait SessionRegistry: Send + Sync {
    async fn lookup(&self, session_pub: &str) -> Option<Session>;
    /// Atomic conditional debit. Returns Err with the snapshot when the cap would be exceeded.
    async fn consume(&self, session_pub: &str, amount: u128) -> Result<u128, SessionError>;
}

/// Test / dev in-memory registry. Mirrors `SessionKey.sol` semantics one-to-one.
#[derive(Default, Clone)]
pub struct InMemoryRegistry {
    inner: Arc<RwLock<HashMap<String, Session>>>,
}

impl InMemoryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        session_pub: &str,
        owner: &str,
        expires_at_secs: u64,
        max_notional_usdc: u128,
    ) {
        self.inner.write().insert(
            session_pub.to_ascii_lowercase(),
            Session {
                owner: owner.to_string(),
                expires_at_secs,
                max_notional_usdc,
                spent_notional_usdc: 0,
                active: true,
            },
        );
    }

    pub fn revoke(&self, session_pub: &str) {
        if let Some(s) = self
            .inner
            .write()
            .get_mut(&session_pub.to_ascii_lowercase())
        {
            s.active = false;
        }
    }
}

#[async_trait]
impl SessionRegistry for InMemoryRegistry {
    async fn lookup(&self, session_pub: &str) -> Option<Session> {
        self.inner
            .read()
            .get(&session_pub.to_ascii_lowercase())
            .cloned()
    }

    async fn consume(&self, session_pub: &str, amount: u128) -> Result<u128, SessionError> {
        let mut g = self.inner.write();
        let s = g
            .get_mut(&session_pub.to_ascii_lowercase())
            .ok_or(SessionError::NotRegistered)?;
        if !s.active {
            return Err(SessionError::Inactive);
        }
        if now_secs() >= s.expires_at_secs {
            return Err(SessionError::Expired);
        }
        let new_spent =
            s.spent_notional_usdc
                .checked_add(amount)
                .ok_or(SessionError::CapExceeded {
                    spent: s.spent_notional_usdc,
                    amount,
                    cap: s.max_notional_usdc,
                })?;
        if new_spent > s.max_notional_usdc {
            return Err(SessionError::CapExceeded {
                spent: s.spent_notional_usdc,
                amount,
                cap: s.max_notional_usdc,
            });
        }
        s.spent_notional_usdc = new_spent;
        Ok(new_spent)
    }
}

/// Recover the signer EOA from a 65-byte secp256k1 signature over `digest` (32 bytes).
/// Signature format: `0x` + 64 bytes r||s + 1 byte v (27/28 or 0/1).
pub fn recover_signer(digest: &[u8; 32], signature_hex: &str) -> Result<String, SessionError> {
    let hex = signature_hex
        .strip_prefix("0x")
        .ok_or_else(|| SessionError::BadEncoding("missing 0x prefix".into()))?;
    let raw = hex::decode(hex).map_err(|e| SessionError::BadEncoding(e.to_string()))?;
    if raw.len() != 65 {
        return Err(SessionError::BadEncoding(format!(
            "expected 65 bytes, got {}",
            raw.len()
        )));
    }
    let v = raw[64];
    let rec_id = match v {
        0 | 27 => RecoveryId::from_byte(0),
        1 | 28 => RecoveryId::from_byte(1),
        _ => None,
    }
    .ok_or(SessionError::RecoverFailed)?;
    let sig = Signature::from_slice(&raw[..64]).map_err(|_| SessionError::RecoverFailed)?;
    let vk = VerifyingKey::recover_from_prehash(digest, &sig, rec_id)
        .map_err(|_| SessionError::RecoverFailed)?;
    Ok(address_from_pubkey(&vk))
}

fn address_from_pubkey(vk: &VerifyingKey) -> String {
    let point = vk.to_encoded_point(false);
    let bytes = point.as_bytes();
    // EncodedPoint is 0x04 || X(32) || Y(32). Address = last 20 bytes of keccak256(X||Y).
    let mut hasher = Keccak256::new();
    hasher.update(&bytes[1..]);
    let h = hasher.finalize();
    format!("0x{}", hex::encode(&h[12..]))
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_secs()
}

/// Full verification chain. Returns the cumulative spent notional after the debit.
pub async fn verify_order_chain<R: SessionRegistry + ?Sized>(
    digest: &[u8; 32],
    signature_hex: &str,
    jwt_caller_address: &str,
    notional_usdc: u128,
    registry: &R,
) -> Result<u128, SessionError> {
    let session_pub = recover_signer(digest, signature_hex)?;
    let session = registry
        .lookup(&session_pub)
        .await
        .ok_or(SessionError::NotRegistered)?;
    if !session.active {
        return Err(SessionError::Inactive);
    }
    if now_secs() >= session.expires_at_secs {
        return Err(SessionError::Expired);
    }
    if !session.owner.eq_ignore_ascii_case(jwt_caller_address) {
        return Err(SessionError::OwnerMismatch {
            recovered: session.owner,
            claimed: jwt_caller_address.to_string(),
        });
    }
    registry.consume(&session_pub, notional_usdc).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};

    fn random_signing_key() -> SigningKey {
        SigningKey::from_slice(&[7u8; 32]).unwrap()
    }

    fn sign_prehash(sk: &SigningKey, digest: &[u8; 32]) -> String {
        let (sig, rec_id): (Signature, RecoveryId) = sk.sign_prehash(digest).unwrap();
        let mut bytes = [0u8; 65];
        bytes[..64].copy_from_slice(&sig.to_bytes());
        bytes[64] = rec_id.to_byte() + 27;
        format!("0x{}", hex::encode(bytes))
    }

    #[test]
    fn recover_matches_address_derivation() {
        let sk = random_signing_key();
        let digest = [9u8; 32];
        let sig = sign_prehash(&sk, &digest);
        let recovered = recover_signer(&digest, &sig).unwrap();
        let expected = address_from_pubkey(sk.verifying_key());
        assert_eq!(recovered, expected);
    }

    #[test]
    fn bad_signature_encoding_rejected() {
        assert!(matches!(
            recover_signer(&[0; 32], "deadbeef"),
            Err(SessionError::BadEncoding(_))
        ));
        assert!(matches!(
            recover_signer(&[0; 32], "0xabcd"),
            Err(SessionError::BadEncoding(_))
        ));
    }

    #[tokio::test]
    async fn chain_succeeds_within_cap() {
        let sk = random_signing_key();
        let session_pub = address_from_pubkey(sk.verifying_key());
        let owner = "0x000000000000000000000000000000000000aBcD";
        let reg = InMemoryRegistry::new();
        reg.register(&session_pub, owner, now_secs() + 3600, 100_000_000); // $100 cap

        let digest = [1u8; 32];
        let sig = sign_prehash(&sk, &digest);
        let spent = verify_order_chain(&digest, &sig, owner, 1_000_000, &reg)
            .await
            .unwrap();
        assert_eq!(spent, 1_000_000);

        let spent = verify_order_chain(&digest, &sig, owner, 2_000_000, &reg)
            .await
            .unwrap();
        assert_eq!(spent, 3_000_000);
    }

    #[tokio::test]
    async fn chain_rejects_owner_mismatch() {
        let sk = random_signing_key();
        let session_pub = address_from_pubkey(sk.verifying_key());
        let reg = InMemoryRegistry::new();
        reg.register(&session_pub, "0xaaaa", now_secs() + 3600, 1_000_000);

        let digest = [2u8; 32];
        let sig = sign_prehash(&sk, &digest);
        let err = verify_order_chain(&digest, &sig, "0xbbbb", 1, &reg)
            .await
            .unwrap_err();
        assert!(matches!(err, SessionError::OwnerMismatch { .. }));
    }

    #[tokio::test]
    async fn chain_rejects_when_not_registered() {
        let sk = random_signing_key();
        let reg = InMemoryRegistry::new();
        let digest = [3u8; 32];
        let sig = sign_prehash(&sk, &digest);
        let err = verify_order_chain(&digest, &sig, "0xaaaa", 1, &reg)
            .await
            .unwrap_err();
        assert!(matches!(err, SessionError::NotRegistered));
    }

    #[tokio::test]
    async fn chain_rejects_after_revoke() {
        let sk = random_signing_key();
        let session_pub = address_from_pubkey(sk.verifying_key());
        let owner = "0xowner";
        let reg = InMemoryRegistry::new();
        reg.register(&session_pub, owner, now_secs() + 3600, 1_000_000);
        reg.revoke(&session_pub);

        let digest = [4u8; 32];
        let sig = sign_prehash(&sk, &digest);
        let err = verify_order_chain(&digest, &sig, owner, 1, &reg)
            .await
            .unwrap_err();
        assert!(matches!(err, SessionError::Inactive));
    }

    #[tokio::test]
    async fn chain_rejects_over_cap() {
        let sk = random_signing_key();
        let session_pub = address_from_pubkey(sk.verifying_key());
        let owner = "0xowner";
        let reg = InMemoryRegistry::new();
        reg.register(&session_pub, owner, now_secs() + 3600, 5_000_000);

        let digest = [5u8; 32];
        let sig = sign_prehash(&sk, &digest);
        verify_order_chain(&digest, &sig, owner, 4_000_000, &reg)
            .await
            .unwrap();
        let err = verify_order_chain(&digest, &sig, owner, 2_000_000, &reg)
            .await
            .unwrap_err();
        assert!(matches!(err, SessionError::CapExceeded { .. }));
    }

    #[tokio::test]
    async fn one_hundred_orders_in_a_row() {
        // Acceptance mirror: frontend signs 100 orders without a wallet popup.
        let sk = random_signing_key();
        let session_pub = address_from_pubkey(sk.verifying_key());
        let owner = "0xowner";
        let reg = InMemoryRegistry::new();
        reg.register(&session_pub, owner, now_secs() + 3600, 100_000_000_000);

        for i in 0..100 {
            let mut digest = [0u8; 32];
            digest[0] = i as u8;
            let sig = sign_prehash(&sk, &digest);
            verify_order_chain(&digest, &sig, owner, 1_000_000, &reg)
                .await
                .unwrap();
        }
        let final_session = reg.lookup(&session_pub).await.unwrap();
        assert_eq!(final_session.spent_notional_usdc, 100_000_000);
    }
}
