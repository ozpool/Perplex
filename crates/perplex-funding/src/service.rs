use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rust_decimal::Decimal;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::error::FundingError;
use crate::leader::LeaseBackend;

/// Premium feed: returns the (mark - index) / index averaged over the elapsed interval,
/// scaled 1e18. The on-chain FundingEngine clamps this to ±MAX_PREMIUM_ABS, so producers
/// are free to return raw values.
#[async_trait]
pub trait PremiumSource: Send + Sync {
    async fn premium_for(&self, market: &str) -> Result<Decimal, FundingError>;
}

/// On-chain submitter trait. Implementations call FundingEngine.applyFunding(market, premium).
#[async_trait]
pub trait FundingSubmitter: Send + Sync {
    async fn submit(&self, market: &str, premium_x18: Decimal) -> Result<(), FundingError>;
}

#[derive(Debug, Clone)]
pub struct FundingConfig {
    /// Markets to publish funding for.
    pub markets: Vec<String>,
    /// On-chain interval between funding ticks. The service ticks the clock at this cadence;
    /// the on-chain contract enforces the gate.
    pub funding_interval: Duration,
    /// Lease TTL. Per the issue acceptance criterion this is 60s.
    pub lease_ttl: Duration,
    /// How often to attempt lease renewal while we are the leader. Must be < lease_ttl/2 so
    /// a network blip doesn't drop the lease.
    pub renew_every: Duration,
    /// Redis key prefix for the lease.
    pub lease_key_prefix: String,
}

impl Default for FundingConfig {
    fn default() -> Self {
        Self {
            markets: Vec::new(),
            funding_interval: Duration::from_secs(8 * 3600),
            lease_ttl: Duration::from_secs(60),
            renew_every: Duration::from_secs(20),
            lease_key_prefix: "perplex:funding:leader".into(),
        }
    }
}

pub struct FundingService<B: LeaseBackend, P: PremiumSource, S: FundingSubmitter> {
    pub id: String,
    backend: B,
    premiums: Arc<P>,
    submitter: Arc<S>,
    cfg: FundingConfig,
}

impl<B: LeaseBackend + 'static, P: PremiumSource + 'static, S: FundingSubmitter + 'static>
    FundingService<B, P, S>
{
    pub fn new(backend: B, premiums: Arc<P>, submitter: Arc<S>, cfg: FundingConfig) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            backend,
            premiums,
            submitter,
            cfg,
        }
    }

    fn lease_key(&self) -> String {
        self.cfg.lease_key_prefix.clone()
    }

    /// Run forever. The future returns only on cancellation.
    pub async fn run(self) -> Result<(), FundingError> {
        let mut tick = interval(self.cfg.funding_interval);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut renew = interval(self.cfg.renew_every);
        renew.set_missed_tick_behavior(MissedTickBehavior::Skip);

        info!(id = %self.id, "funding service started");

        let mut hold_lease = false;
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    // Try to renew first (covers the steady-state case where we already hold the
                    // lease). If renew fails — either we never had it, or the TTL expired
                    // because a renew got dropped — attempt a fresh SETNX acquisition. The
                    // backend enforces ownership on renew so a peer can't accidentally steal.
                    let renewed = if hold_lease {
                        self.backend
                            .renew(&self.lease_key(), &self.id, self.cfg.lease_ttl)
                            .await
                            .unwrap_or(false)
                    } else {
                        false
                    };
                    if renewed {
                        hold_lease = true;
                    } else {
                        let acquired = self
                            .backend
                            .try_acquire(&self.lease_key(), &self.id, self.cfg.lease_ttl)
                            .await
                            .unwrap_or(false);
                        hold_lease = acquired;
                    }
                    if hold_lease {
                        info!(id = %self.id, "leader for this tick");
                        for market in &self.cfg.markets {
                            match self.premiums.premium_for(market).await {
                                Ok(prem) => {
                                    if let Err(e) = self.submitter.submit(market, prem).await {
                                        warn!(id = %self.id, %market, ?e, "submit failed");
                                    }
                                }
                                Err(e) => warn!(id = %self.id, %market, ?e, "premium fetch failed"),
                            }
                        }
                    } else {
                        debug!(id = %self.id, "not leader; skipping submit");
                    }
                }
                _ = renew.tick(), if hold_lease => {
                    let ok = self
                        .backend
                        .renew(&self.lease_key(), &self.id, self.cfg.lease_ttl)
                        .await
                        .unwrap_or(false);
                    if !ok {
                        warn!(id = %self.id, "lease lost — will re-elect on next tick");
                        hold_lease = false;
                    }
                }
            }
        }
    }
}
