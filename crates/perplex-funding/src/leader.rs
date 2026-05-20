use std::time::Duration;

use async_trait::async_trait;

use crate::error::FundingError;

/// Distributed lease backend. The contract is Redis-SETNX semantics:
///   - `try_acquire` succeeds only if the key is unset, and sets it with `ttl` expiry.
///   - `renew` extends the TTL only when the holder still owns the key.
///   - `release` clears the key only when the holder still owns it.
///
/// The token argument is a per-process UUID — the backend MUST verify ownership before
/// renewing or releasing so a stale process can't free another instance's lease.
#[async_trait]
pub trait LeaseBackend: Send + Sync + Clone {
    async fn try_acquire(
        &self,
        key: &str,
        token: &str,
        ttl: Duration,
    ) -> Result<bool, FundingError>;
    async fn renew(&self, key: &str, token: &str, ttl: Duration) -> Result<bool, FundingError>;
    async fn release(&self, key: &str, token: &str) -> Result<(), FundingError>;
}

/// Process-local mock backend with real SETNX-NX semantics and TTL expiry. Used by the
/// multi-instance leader-election tests; the same trait is implemented for real Redis in
/// `redis_backend.rs`.
pub mod mock {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::time::Instant;

    #[derive(Default, Clone)]
    pub struct MockBackend {
        inner: Arc<Mutex<HashMap<String, (String, Instant)>>>,
    }

    impl MockBackend {
        pub fn new() -> Self {
            Self::default()
        }

        fn gc(&self, now: Instant) {
            let mut g = self.inner.lock().unwrap();
            g.retain(|_, (_, expires)| *expires > now);
        }
    }

    #[async_trait]
    impl LeaseBackend for MockBackend {
        async fn try_acquire(
            &self,
            key: &str,
            token: &str,
            ttl: Duration,
        ) -> Result<bool, FundingError> {
            let now = Instant::now();
            self.gc(now);
            let mut g = self.inner.lock().unwrap();
            if g.contains_key(key) {
                return Ok(false);
            }
            g.insert(key.to_string(), (token.to_string(), now + ttl));
            Ok(true)
        }

        async fn renew(&self, key: &str, token: &str, ttl: Duration) -> Result<bool, FundingError> {
            let now = Instant::now();
            self.gc(now);
            let mut g = self.inner.lock().unwrap();
            match g.get_mut(key) {
                Some((owner, expires)) if owner == token => {
                    *expires = now + ttl;
                    Ok(true)
                }
                _ => Ok(false),
            }
        }

        async fn release(&self, key: &str, token: &str) -> Result<(), FundingError> {
            let mut g = self.inner.lock().unwrap();
            if matches!(g.get(key), Some((o, _)) if o == token) {
                g.remove(key);
            }
            Ok(())
        }
    }
}

/// Real-Redis backend. Uses SET key val NX PX ttl for acquire and tiny Lua scripts for the
/// ownership-checked renew and release operations. Not unit-tested here (requires a live
/// Redis instance); behaviour is covered by the mock backend's identical contract.
pub mod redis_backend {
    use super::*;
    use redis::AsyncCommands;

    #[derive(Clone)]
    pub struct RedisBackend {
        client: redis::Client,
    }

    impl RedisBackend {
        pub fn new(url: &str) -> Result<Self, FundingError> {
            Ok(Self {
                client: redis::Client::open(url)?,
            })
        }
    }

    const RENEW_SCRIPT: &str = r#"
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('pexpire', KEYS[1], ARGV[2])
        else
            return 0
        end
    "#;

    const RELEASE_SCRIPT: &str = r#"
        if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('del', KEYS[1])
        else
            return 0
        end
    "#;

    #[async_trait]
    impl LeaseBackend for RedisBackend {
        async fn try_acquire(
            &self,
            key: &str,
            token: &str,
            ttl: Duration,
        ) -> Result<bool, FundingError> {
            let mut conn = self.client.get_multiplexed_async_connection().await?;
            let opts = redis::SetOptions::default()
                .conditional_set(redis::ExistenceCheck::NX)
                .with_expiration(redis::SetExpiry::PX(ttl.as_millis() as u64));
            let res: Option<String> = conn.set_options(key, token, opts).await?;
            Ok(res.as_deref() == Some("OK"))
        }

        async fn renew(&self, key: &str, token: &str, ttl: Duration) -> Result<bool, FundingError> {
            let mut conn = self.client.get_multiplexed_async_connection().await?;
            let res: i64 = redis::Script::new(RENEW_SCRIPT)
                .key(key)
                .arg(token)
                .arg(ttl.as_millis() as u64)
                .invoke_async(&mut conn)
                .await?;
            Ok(res == 1)
        }

        async fn release(&self, key: &str, token: &str) -> Result<(), FundingError> {
            let mut conn = self.client.get_multiplexed_async_connection().await?;
            let _: i64 = redis::Script::new(RELEASE_SCRIPT)
                .key(key)
                .arg(token)
                .invoke_async(&mut conn)
                .await?;
            Ok(())
        }
    }
}
