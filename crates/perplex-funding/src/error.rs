use thiserror::Error;

#[derive(Debug, Error)]
pub enum FundingError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("backend error: {0}")]
    Backend(String),
    #[error("submitter error: {0}")]
    Submitter(String),
}
