use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use thiserror::Error;

/// Top-level API error. Maps to the error envelope in api-contract.md section 0:
/// `{ "error": { "code": "...", "message": "...", "detail": ... } }`.
#[derive(Debug, Error)]
pub enum ApiError {
    #[error("rate limited")]
    RateLimited,
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("not found")]
    NotFound,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("market not active")]
    MarketInactive,
    #[error("insufficient margin")]
    InsufficientMargin { free: String, required: String },
    #[error("invalid signature")]
    InvalidSignature,
    #[error("post-only would cross")]
    PostOnlyWouldCross,
    #[error("internal: {0}")]
    Internal(String),
}

impl ApiError {
    fn code(&self) -> &'static str {
        match self {
            ApiError::RateLimited => "RATE_LIMITED",
            ApiError::Unauthorized(_) => "UNAUTHORIZED",
            ApiError::NotFound => "NOT_FOUND",
            ApiError::BadRequest(_) => "BAD_REQUEST",
            ApiError::MarketInactive => "MARKET_INACTIVE",
            ApiError::InsufficientMargin { .. } => "INSUFFICIENT_MARGIN",
            ApiError::InvalidSignature => "INVALID_SIGNATURE",
            ApiError::PostOnlyWouldCross => "POST_ONLY_WOULD_CROSS",
            ApiError::Internal(_) => "INTERNAL",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            ApiError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::MarketInactive => StatusCode::BAD_REQUEST,
            ApiError::InsufficientMargin { .. } => StatusCode::FORBIDDEN,
            ApiError::InvalidSignature => StatusCode::UNAUTHORIZED,
            ApiError::PostOnlyWouldCross => StatusCode::BAD_REQUEST,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let detail = match &self {
            ApiError::InsufficientMargin { free, required } => Some(json!({
                "free": free,
                "required": required,
            })),
            _ => None,
        };
        let mut body = json!({
            "error": {
                "code": self.code(),
                "message": self.to_string(),
            }
        });
        if let Some(d) = detail {
            body["error"]["detail"] = d;
        }
        (self.status(), Json(body)).into_response()
    }
}
