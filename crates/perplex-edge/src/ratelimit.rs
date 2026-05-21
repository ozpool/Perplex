//! Redis-backed token-bucket rate limiter.
//!
//! Two limits per api-contract.md:
//!   - Public endpoints: 100 requests / second / IP
//!   - Authed endpoints: 1000 requests / second / wallet address
//!
//! The bucket logic runs as an atomic Lua script in Redis so concurrent edge replicas share a
//! single rate-limit view. A process-local fallback (`InMemoryBucket`) implements the same
//! contract for unit tests and devnet without Redis.
//!
//! On reject the middleware returns HTTP 429 with a `Retry-After: <seconds>` header.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use thiserror::Error;

use crate::auth::verify_jwt;
use crate::state::AppState;

/// Bucket parameters per request class.
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    /// Maximum tokens the bucket can hold (burst capacity).
    pub capacity: u32,
    /// Tokens refilled per second (sustained rate).
    pub refill_per_sec: u32,
}

impl Limit {
    pub const PUBLIC: Limit = Limit {
        capacity: 200,
        refill_per_sec: 100,
    };
    pub const AUTHED: Limit = Limit {
        capacity: 2_000,
        refill_per_sec: 1_000,
    };
}

#[derive(Debug, Error)]
pub enum RateLimitError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("clock error")]
    Clock,
}

#[derive(Debug, Clone, Copy)]
pub struct Allowed {
    pub remaining: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct Denied {
    /// Suggested seconds the caller should wait before retrying.
    pub retry_after_secs: u32,
}

pub type CheckResult = Result<Allowed, Denied>;

#[async_trait]
pub trait Bucket: Send + Sync + 'static {
    async fn check(&self, key: &str, limit: Limit) -> Result<CheckResult, RateLimitError>;
}

/// Real-Redis implementation. The Lua script is atomic across replicas and refills tokens
/// linearly with the wall clock.
#[derive(Clone)]
pub struct RedisBucket {
    client: redis::Client,
}

impl RedisBucket {
    pub fn new(url: &str) -> Result<Self, RateLimitError> {
        Ok(Self {
            client: redis::Client::open(url)?,
        })
    }
}

const TOKEN_BUCKET_LUA: &str = r#"
-- KEYS[1] = bucket key
-- ARGV[1] = now_ms
-- ARGV[2] = capacity
-- ARGV[3] = refill_per_sec
-- Returns: { allowed (0|1), remaining, retry_after_secs }
local now_ms = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill = tonumber(ARGV[3])

local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = tonumber(bucket[1])
local updated = tonumber(bucket[2])
if tokens == nil then
  tokens = capacity
  updated = now_ms
end

local elapsed_ms = math.max(0, now_ms - updated)
local refilled = (elapsed_ms * refill) / 1000.0
tokens = math.min(capacity, tokens + refilled)

local allowed = 0
local retry_after = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  local need = 1 - tokens
  retry_after = math.ceil(need * 1000.0 / refill / 1000.0)
  if retry_after < 1 then retry_after = 1 end
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'updated', now_ms)
redis.call('PEXPIRE', KEYS[1], 60000)
return { allowed, math.floor(tokens), retry_after }
"#;

#[async_trait]
impl Bucket for RedisBucket {
    async fn check(&self, key: &str, limit: Limit) -> Result<CheckResult, RateLimitError> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| RateLimitError::Clock)?
            .as_millis() as u64;
        let res: (i64, i64, i64) = redis::Script::new(TOKEN_BUCKET_LUA)
            .key(key)
            .arg(now_ms)
            .arg(limit.capacity)
            .arg(limit.refill_per_sec)
            .invoke_async(&mut conn)
            .await?;
        if res.0 == 1 {
            Ok(Ok(Allowed {
                remaining: res.1.max(0) as u32,
            }))
        } else {
            Ok(Err(Denied {
                retry_after_secs: res.2.max(1) as u32,
            }))
        }
    }
}

/// Process-local fallback. Mirrors the Lua script semantics with millisecond precision.
#[derive(Default, Clone)]
pub struct InMemoryBucket {
    inner: Arc<Mutex<HashMap<String, (f64, u64)>>>, // key -> (tokens, updated_ms)
}

impl InMemoryBucket {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Bucket for InMemoryBucket {
    async fn check(&self, key: &str, limit: Limit) -> Result<CheckResult, RateLimitError> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| RateLimitError::Clock)?
            .as_millis() as u64;
        let mut g = self.inner.lock();
        let entry = g
            .entry(key.to_string())
            .or_insert((limit.capacity as f64, now_ms));
        let elapsed_ms = now_ms.saturating_sub(entry.1) as f64;
        let refilled = (elapsed_ms * limit.refill_per_sec as f64) / 1000.0;
        entry.0 = (entry.0 + refilled).min(limit.capacity as f64);
        entry.1 = now_ms;
        if entry.0 >= 1.0 {
            entry.0 -= 1.0;
            Ok(Ok(Allowed {
                remaining: entry.0 as u32,
            }))
        } else {
            let need = 1.0 - entry.0;
            let secs = (need / limit.refill_per_sec as f64).ceil().max(1.0) as u32;
            Ok(Err(Denied {
                retry_after_secs: secs,
            }))
        }
    }
}

#[derive(Clone)]
pub struct RateLimiter {
    pub bucket: Arc<dyn Bucket>,
    pub public_limit: Limit,
    pub authed_limit: Limit,
}

impl RateLimiter {
    pub fn in_memory() -> Self {
        Self {
            bucket: Arc::new(InMemoryBucket::new()),
            public_limit: Limit::PUBLIC,
            authed_limit: Limit::AUTHED,
        }
    }
}

/// Axum middleware that gates every request. Authenticated calls (Bearer JWT) get the higher
/// per-wallet bucket; unauthenticated calls get the per-IP bucket.
pub async fn rate_limit_layer(
    State((state, limiter)): State<(AppState, RateLimiter)>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let (key, limit) = classify(&state, &limiter, &peer, &req);
    match limiter.bucket.check(&key, limit).await {
        Ok(Ok(_)) => next.run(req).await,
        Ok(Err(denied)) => deny_response(denied),
        Err(e) => {
            tracing::warn!(?e, "rate limiter failure — fail-open");
            next.run(req).await
        }
    }
}

fn classify(
    state: &AppState,
    limiter: &RateLimiter,
    peer: &std::net::SocketAddr,
    req: &Request,
) -> (String, Limit) {
    if let Some(bearer) = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
    {
        if let Ok(claims) = verify_jwt(state.jwt_secret(), bearer) {
            return (format!("rl:wallet:{}", claims.sub), limiter.authed_limit);
        }
    }
    (format!("rl:ip:{}", peer.ip()), limiter.public_limit)
}

fn deny_response(d: Denied) -> Response {
    let body = serde_json::json!({
        "error": {
            "code": "RATE_LIMITED",
            "message": "rate limit exceeded",
        }
    });
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, d.retry_after_secs.to_string())],
        axum::Json(body),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn burst_within_capacity_is_allowed() {
        let bucket = InMemoryBucket::new();
        let limit = Limit {
            capacity: 5,
            refill_per_sec: 1,
        };
        for _ in 0..5 {
            assert!(matches!(
                bucket.check("k", limit).await.unwrap(),
                Ok(Allowed { .. })
            ));
        }
    }

    #[tokio::test]
    async fn exceeding_burst_returns_denied_with_retry_after() {
        let bucket = InMemoryBucket::new();
        let limit = Limit {
            capacity: 3,
            refill_per_sec: 1,
        };
        for _ in 0..3 {
            assert!(matches!(
                bucket.check("k", limit).await.unwrap(),
                Ok(Allowed { .. })
            ));
        }
        let denied = bucket.check("k", limit).await.unwrap().unwrap_err();
        assert!(denied.retry_after_secs >= 1);
    }

    #[tokio::test]
    async fn refill_restores_tokens_over_time() {
        let bucket = InMemoryBucket::new();
        let limit = Limit {
            capacity: 2,
            refill_per_sec: 100, // very fast refill so the test stays sub-second
        };
        bucket.check("k", limit).await.unwrap().unwrap();
        bucket.check("k", limit).await.unwrap().unwrap();
        // Immediately denied.
        assert!(bucket.check("k", limit).await.unwrap().is_err());
        // After ~30ms we should have ~3 tokens refilled — bucket capped at 2.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(matches!(
            bucket.check("k", limit).await.unwrap(),
            Ok(Allowed { .. })
        ));
    }

    #[tokio::test]
    async fn keys_are_isolated() {
        let bucket = InMemoryBucket::new();
        let limit = Limit {
            capacity: 1,
            refill_per_sec: 1,
        };
        bucket.check("a", limit).await.unwrap().unwrap();
        // "a" is now empty, but "b" has full capacity.
        assert!(bucket.check("a", limit).await.unwrap().is_err());
        assert!(matches!(
            bucket.check("b", limit).await.unwrap(),
            Ok(Allowed { .. })
        ));
    }
}
