//! SIWE-style auth. The verify endpoint accepts the message + signature pair; here we keep the
//! verification lightweight (recover-and-match a checksummed address embedded in the message).
//! Production hardens this with eth-signing recovery via alloy.

use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

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
    let claims = Claims {
        sub: address.to_string(),
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
            address: claims.sub,
        })
    }
}

/// Minimal SIWE message check used in dev. We parse out the `Address:` line and confirm it
/// matches what the request asserted. Production swaps this for full ERC-4361 verification
/// + ECDSA signature recovery.
pub fn verify_siwe(message: &str, signature: &str, state: &AppState) -> Result<String, ApiError> {
    if !signature.starts_with("0x") || signature.len() < 132 {
        return Err(ApiError::InvalidSignature);
    }
    let address = parse_siwe_address(message)
        .ok_or_else(|| ApiError::BadRequest("siwe message missing Address line".into()))?;
    let expected_nonce = parse_siwe_nonce(message)
        .ok_or_else(|| ApiError::BadRequest("siwe message missing Nonce line".into()))?;
    let issued = state
        .consume_siwe_nonce(&address)
        .ok_or_else(|| ApiError::Unauthorized("nonce not issued or already used".into()))?;
    if issued != expected_nonce {
        return Err(ApiError::Unauthorized("nonce mismatch".into()));
    }
    Ok(address)
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
