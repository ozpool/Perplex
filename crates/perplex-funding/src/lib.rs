//! Off-chain funding cron with Redis SETNX leader election.
//!
//! Multiple instances of this service may be deployed in parallel for HA. At every
//! `funding_interval` tick, each instance attempts `SET key value NX PX ttl` against the
//! lease key. Exactly one wins and calls `FundingEngine.applyFunding(marketId, premium)`
//! on-chain. The winner periodically renews the lease so a stop-the-world GC doesn't drop
//! it mid-cycle; on lease loss it falls back to followers on the next tick.
//!
//! The leader-election test exercises this with three concurrent services against a shared
//! in-process mock backend implementing the same SET-NX-PX semantics as Redis.

pub mod error;
pub mod leader;
pub mod service;

pub use error::FundingError;
pub use leader::{mock::MockBackend, redis_backend::RedisBackend, LeaseBackend};
pub use service::{FundingConfig, FundingService, FundingSubmitter, PremiumSource};

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use rust_decimal::Decimal;
    use rust_decimal_macros::dec;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;

    #[derive(Default)]
    struct StaticPremiums;

    #[async_trait]
    impl PremiumSource for StaticPremiums {
        async fn premium_for(&self, _market: &str) -> Result<Decimal, FundingError> {
            Ok(dec!(0.0001))
        }
    }

    #[derive(Default)]
    struct CountingSubmitter {
        submissions: Mutex<Vec<(String, Decimal)>>,
        counter: AtomicUsize,
    }

    #[async_trait]
    impl FundingSubmitter for CountingSubmitter {
        async fn submit(&self, market: &str, premium_x18: Decimal) -> Result<(), FundingError> {
            self.counter.fetch_add(1, Ordering::SeqCst);
            self.submissions
                .lock()
                .await
                .push((market.to_string(), premium_x18));
            Ok(())
        }
    }

    /// Acceptance criterion: spawn 3 funding services, exactly one submits per cycle.
    #[tokio::test(start_paused = true)]
    async fn three_instances_single_leader_per_cycle() {
        let backend = MockBackend::new();
        let premiums = Arc::new(StaticPremiums);
        let sub = Arc::new(CountingSubmitter::default());

        let cfg = FundingConfig {
            markets: vec!["btc-usd".into(), "eth-usd".into(), "sol-usd".into()],
            funding_interval: Duration::from_secs(1),
            lease_ttl: Duration::from_millis(800),
            renew_every: Duration::from_millis(300),
            lease_key_prefix: "test:perplex:funding".into(),
        };

        let mut handles = Vec::new();
        for _ in 0..3 {
            let svc =
                FundingService::new(backend.clone(), premiums.clone(), sub.clone(), cfg.clone());
            handles.push(tokio::spawn(svc.run()));
        }

        // Drive virtual time past exactly three funding ticks (interval ticks fire at
        // t=0, 1s, 2s — interval(1s) fires immediately on first poll). Each yield round
        // lets the scheduler drain the tick body. Stop short of the fourth tick at 3s.
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_millis(950)).await;
            for _ in 0..8 {
                tokio::task::yield_now().await;
            }
        }

        for h in handles {
            h.abort();
        }

        let total = sub.counter.load(Ordering::SeqCst);
        // 3 ticks × 3 markets = 9 submissions across the entire fleet. No duplicates.
        assert_eq!(total, 9, "expected exactly 9 submissions, got {}", total);
    }

    /// When the leader dies the lease expires and a follower takes over on the next tick.
    #[tokio::test(start_paused = true)]
    async fn leader_failover_after_lease_expiry() {
        let backend = MockBackend::new();
        let premiums = Arc::new(StaticPremiums);

        let cfg = FundingConfig {
            markets: vec!["btc-usd".into()],
            funding_interval: Duration::from_secs(1),
            lease_ttl: Duration::from_millis(500),
            // Disable auto-renew so the lease expires after 500ms.
            renew_every: Duration::from_secs(3600),
            lease_key_prefix: "test:failover".into(),
        };

        let sub_a = Arc::new(CountingSubmitter::default());
        let sub_b = Arc::new(CountingSubmitter::default());

        let svc_a = FundingService::new(
            backend.clone(),
            premiums.clone(),
            sub_a.clone(),
            cfg.clone(),
        );
        let svc_b = FundingService::new(
            backend.clone(),
            premiums.clone(),
            sub_b.clone(),
            cfg.clone(),
        );

        let h_a = tokio::spawn(svc_a.run());
        let h_b = tokio::spawn(svc_b.run());

        // First funding tick at t=0 (interval fires immediately on first poll). One wins.
        tokio::time::sleep(Duration::from_millis(100)).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let a1 = sub_a.counter.load(Ordering::SeqCst);
        let b1 = sub_b.counter.load(Ordering::SeqCst);
        assert_eq!(a1 + b1, 1, "first tick: exactly one submission");

        // Advance to the next funding tick. Lease (500ms TTL, no renew) expired at t=500ms,
        // so the second tick at t=1s re-elects — the same instance can re-acquire because
        // SETNX now succeeds (key has been gc'd), or a follower picks up.
        tokio::time::sleep(Duration::from_millis(950)).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let a2 = sub_a.counter.load(Ordering::SeqCst);
        let b2 = sub_b.counter.load(Ordering::SeqCst);
        assert_eq!(a2 + b2, 2, "second tick: total of two submissions");

        h_a.abort();
        h_b.abort();
    }
}
