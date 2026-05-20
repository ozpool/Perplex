use thiserror::Error;

#[derive(Debug, Error)]
pub enum OracleError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("missing or malformed field: {0}")]
    Schema(String),
    #[error("unknown feed: {0}")]
    UnknownFeed(String),
    #[error("submitter error: {0}")]
    Submitter(String),
}
