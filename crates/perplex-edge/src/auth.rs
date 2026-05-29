//! SIWE-style auth. The verify endpoint accepts the message + signature pair and performs full
//! ERC-4361 verification: the EIP-191 personal_sign signature is recovered to an Ethereum address
//! and matched against the address asserted in the message, and the message nonce must match a
//! nonce this server issued (single-use). Without the recovery step, anyone could mint a JWT for
//! any address by quoting it in a message — the signature was previously only length-checked.

use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

use crate::error::ApiError;
use crate::state::AppState;

const JWT_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // address
    pub exp: u64,
    pub iat: u64,
}

pub fn issue_jwt(secret: &[u8], address: &str) -> Result<(String, u64), ApiError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ApiError::Internal("clock".into()))?
        .as_secs();
    let exp = now + JWT_TTL_SECS;
    // Normalize the subject to lowercase so every downstream state key
    // (positions, vault, open orders) compares equal regardless of whether the
    // upstream gave us an EIP-55 checksum or a lowercased address. Ethereum
    // addresses are case-insensitive at the protocol layer.
    let claims = Claims {
        sub: address.to_lowercase(),
        exp,
        iat: now,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|e| ApiError::Internal(format!("jwt encode: {e}")))?;
    Ok((token, exp))
}

pub fn verify_jwt(secret: &[u8], token: &str) -> Result<Claims, ApiError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret),
        &Validation::default(),
    )
    .map_err(|e| ApiError::Unauthorized(format!("jwt: {e}")))?;
    Ok(data.claims)
}

/// Extractor that pulls the JWT out of the `Authorization: Bearer …` header and validates it.
/// Handlers that need the caller's address put `AuthedUser` in their signature.
#[derive(Debug, Clone)]
pub struct AuthedUser {
    pub address: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthedUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .ok_or_else(|| ApiError::Unauthorized("missing bearer".into()))?
            .to_str()
            .map_err(|_| ApiError::Unauthorized("bad header".into()))?
            .to_string();
        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::Unauthorized("bad scheme".into()))?;
        let claims = verify_jwt(app_state.jwt_secret(), token)?;
        Ok(AuthedUser {
            address: claims.sub.to_lowercase(),
        })
    }
}

/// Full SIWE verification: recover the signer from the EIP-191 personal_sign signature, confirm
/// it matches the address asserted in the message, and consume a matching server-issued nonce
/// (single-use). Returns the verified, lowercased address.
pub fn verify_siwe(message: &str, signature: &str, state: &AppState) -> Result<String, ApiError> {
    let address = parse_siwe_address(message)
        .ok_or_else(|| ApiError::BadRequest("siwe message missing Address line".into()))?
        .to_lowercase();
    let expected_nonce = parse_siwe_nonce(message)
        .ok_or_else(|| ApiError::BadRequest("siwe message missing Nonce line".into()))?;

    // Recover the signer from the signature and require it to match the asserted address.
    // This is the check that actually authenticates the wallet — without it the address line
    // is self-asserted and forgeable.
    let recovered = recover_personal_sign(message, signature)?;
    if recovered != address {
        return Err(ApiError::Unauthorized(
            "signature does not match address".into(),
        ));
    }

    // Nonce must be one we issued for this address and is consumed on use (replay protection).
    let issued = state
        .consume_siwe_nonce(&address)
        .ok_or_else(|| ApiError::Unauthorized("nonce not issued or already used".into()))?;
    if issued != expected_nonce {
        return Err(ApiError::Unauthorized("nonce mismatch".into()));
    }
    Ok(address)
}

/// Recover the Ethereum address that produced an EIP-191 `personal_sign` signature over `message`.
/// Signature is the standard 65-byte `r || s || v` hex (with or without `0x`); `v` may be 27/28
/// or 0/1. Returns the lowercased `0x…` address.
fn recover_personal_sign(message: &str, signature: &str) -> Result<String, ApiError> {
    let sig_bytes =
        hex::decode(signature.trim_start_matches("0x")).map_err(|_| ApiError::InvalidSignature)?;
    if sig_bytes.len() != 65 {
        return Err(ApiError::InvalidSignature);
    }
    let recovery_id = match sig_bytes[64] {
        27 | 28 => sig_bytes[64] - 27,
        v @ (0 | 1) => v,
        _ => return Err(ApiError::InvalidSignature),
    };
    let signature =
        Signature::from_slice(&sig_bytes[..64]).map_err(|_| ApiError::InvalidSignature)?;
    let recid = RecoveryId::from_byte(recovery_id).ok_or(ApiError::InvalidSignature)?;

    // EIP-191 digest: keccak256("\x19Ethereum Signed Message:\n" + len + message).
    let mut hasher = Keccak256::new();
    hasher.update(format!("\x19Ethereum Signed Message:\n{}", message.len()).as_bytes());
    hasher.update(message.as_bytes());
    let digest = hasher.finalize();

    let vk = VerifyingKey::recover_from_prehash(&digest, &signature, recid)
        .map_err(|_| ApiError::InvalidSignature)?;

    // address = last 20 bytes of keccak256(uncompressed pubkey without the 0x04 prefix).
    let point = vk.to_encoded_point(false);
    let mut h = Keccak256::new();
    h.update(&point.as_bytes()[1..]);
    let hash = h.finalize();
    Ok(format!("0x{}", hex::encode(&hash[12..])))
}

fn parse_siwe_address(msg: &str) -> Option<String> {
    msg.lines()
        .find(|l| l.starts_with("Address: "))
        .map(|l| l.trim_start_matches("Address: ").trim().to_string())
        .or_else(|| {
            // Fallback: SIWE puts the address on the second line of the preamble.
            msg.lines().nth(1).map(|l| l.trim().to_string())
        })
}

fn parse_siwe_nonce(msg: &str) -> Option<String> {
    msg.lines()
        .find(|l| l.starts_with("Nonce: "))
        .map(|l| l.trim_start_matches("Nonce: ").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;

    fn eth_address(vk: &VerifyingKey) -> String {
        let point = vk.to_encoded_point(false);
        let mut h = Keccak256::new();
        h.update(&point.as_bytes()[1..]);
        format!("0x{}", hex::encode(&h.finalize()[12..]))
    }

    fn personal_sign(sk: &SigningKey, msg: &str) -> String {
        let mut hasher = Keccak256::new();
        hasher.update(format!("\x19Ethereum Signed Message:\n{}", msg.len()).as_bytes());
        hasher.update(msg.as_bytes());
        let (sig, recid) = sk.sign_prehash_recoverable(&hasher.finalize()).unwrap();
        let mut bytes = sig.to_bytes().to_vec();
        bytes.push(recid.to_byte() + 27);
        format!("0x{}", hex::encode(&bytes))
    }

    #[test]
    fn recover_personal_sign_round_trips() {
        let sk = SigningKey::from_slice(&[0x11u8; 32]).unwrap();
        let addr = eth_address(sk.verifying_key());
        let msg = "perplex.xyz wants you to sign in\nNonce: abc123";
        let sig = personal_sign(&sk, msg);
        assert_eq!(recover_personal_sign(msg, &sig).unwrap(), addr);
        // A tampered message recovers a different address (signature no longer valid for it).
        assert_ne!(
            recover_personal_sign("tampered message", &sig).unwrap(),
            addr
        );
    }

    #[test]
    fn recover_rejects_malformed_signature() {
        assert!(recover_personal_sign("x", "0xdeadbeef").is_err());
        assert!(recover_personal_sign("x", "not-hex").is_err());
    }
}
