use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rust_decimal::Decimal;
use tokio::time::interval;
use tracing::{debug, info, warn};

use crate::error::OracleError;
use crate::source::{PriceSample, PriceSource};

#[derive(Debug, Clone)]
pub struct RelayerConfig {
    /// Feeds to monitor.
    pub feeds: Vec<String>,
    /// Polling cadence.
    pub poll_interval: Duration,
    /// Submit to the on-chain adapter when |Δprice / last_price| × 10000 > drift_bps.
    pub drift_bps: u32,
    /// Force a submission at least every `heartbeat`, regardless of drift.
    pub heartbeat: Duration,
}

impl Default for RelayerConfig {
    fn default() -> Self {
        Self {
            feeds: Vec::new(),
            poll_interval: Duration::from_millis(250),
            drift_bps: 5, // 0.05%
            heartbeat: Duration::from_secs(60),
        }
    }
}

/// Pluggable on-chain submitter. The relayer calls `submit` whenever drift or heartbeat
/// triggers. Production wires this to an alloy `OracleAdapter.updateAndGetPrice` call;
/// tests use a record-only stub.
#[async_trait]
pub trait Submitter: Send + Sync {
    async fn submit(&self, samples: &[PriceSample]) -> Result<(), OracleError>;
}

pub struct Relayer<S: PriceSource, U: Submitter> {
    source: Arc<S>,
    submitter: Arc<U>,
    config: RelayerConfig,
}

impl<S: PriceSource, U: Submitter> Relayer<S, U> {
    pub fn new(source: Arc<S>, submitter: Arc<U>, config: RelayerConfig) -> Self {
        Self {
            source,
            submitter,
            config,
        }
    }

    /// Run the polling loop. Returns when the source or submitter unrecoverably errors,
    /// or when the future is dropped.
    pub async fn run(self) -> Result<(), OracleError> {
        let mut tick = interval(self.config.poll_interval);
        // Cache last-submitted prices and last submission time per feed.
        let mut last_submitted: HashMap<String, (Decimal, std::time::Instant)> = HashMap::new();
        info!(feeds = self.config.feeds.len(), "oracle relayer started");

        loop {
            tick.tick().await;
            let samples = match self.source.fetch(&self.config.feeds).await {
                Ok(s) => s,
                Err(e) => {
                    warn!(?e, "oracle source fetch failed; retrying");
                    continue;
                }
            };
            let mut to_submit: Vec<PriceSample> = Vec::new();
            for s in &samples {
                let should = match last_submitted.get(&s.feed_id) {
                    Some((last_p, last_t)) => {
                        let drift = drift_bps(*last_p, s.price_x18);
                        let due_heartbeat = last_t.elapsed() >= self.config.heartbeat;
                        debug!(feed = %s.feed_id, drift_bps = drift, due_heartbeat, "drift sample");
                        drift > self.config.drift_bps || due_heartbeat
                    }
                    None => true, // first sample always submits
                };
                if should {
                    to_submit.push(s.clone());
                }
            }
            if !to_submit.is_empty() {
                if let Err(e) = self.submitter.submit(&to_submit).await {
                    warn!(?e, "submitter failed; will retry next tick");
                    continue;
                }
                let now = std::time::Instant::now();
                for s in to_submit {
                    last_submitted.insert(s.feed_id, (s.price_x18, now));
                }
            }
        }
    }
}

fn drift_bps(prev: Decimal, current: Decimal) -> u32 {
    if prev.is_zero() {
        return u32::MAX; // first-time always triggers
    }
    let delta = (current - prev).abs();
    let bps = delta * Decimal::from(10_000u32) / prev.abs();
    // Decimal -> u32 with saturation
    use rust_decimal::prelude::ToPrimitive;
    bps.trunc().to_u32().unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MockSource;
    use rust_decimal_macros::dec;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingSubmitter {
        calls: Mutex<Vec<Vec<PriceSample>>>,
    }

    #[async_trait]
    impl Submitter for RecordingSubmitter {
        async fn submit(&self, samples: &[PriceSample]) -> Result<(), OracleError> {
            self.calls.lock().unwrap().push(samples.to_vec());
            Ok(())
        }
    }

    #[tokio::test(start_paused = true)]
    async fn first_sample_always_submits() {
        let src = Arc::new(MockSource::new());
        src.set_price("btc", dec!(100_000), 0);
        let sub = Arc::new(RecordingSubmitter::default());
        let cfg = RelayerConfig {
            feeds: vec!["btc".into()],
            poll_interval: Duration::from_millis(10),
            drift_bps: 5,
            heartbeat: Duration::from_secs(60),
        };
        let relayer = Relayer::new(src.clone(), sub.clone(), cfg);
        let handle = tokio::spawn(relayer.run());

        tokio::time::sleep(Duration::from_millis(50)).await;
        handle.abort();

        let calls = sub.calls.lock().unwrap();
        assert!(!calls.is_empty(), "first poll should submit");
        assert_eq!(calls[0].len(), 1);
        assert_eq!(calls[0][0].feed_id, "btc");
    }

    #[tokio::test(start_paused = true)]
    async fn drift_below_threshold_skips_submission() {
        let src = Arc::new(MockSource::new());
        src.set_price("btc", dec!(100_000), 0);
        let sub = Arc::new(RecordingSubmitter::default());
        let cfg = RelayerConfig {
            feeds: vec!["btc".into()],
            poll_interval: Duration::from_millis(10),
            drift_bps: 50, // 0.5%
            heartbeat: Duration::from_secs(600),
        };
        let relayer = Relayer::new(src.clone(), sub.clone(), cfg);
        let handle = tokio::spawn(relayer.run());
        tokio::time::sleep(Duration::from_millis(40)).await;

        // Move price by 0.01% — well below 0.5% drift threshold.
        src.set_price("btc", dec!(100_010), 1);
        tokio::time::sleep(Duration::from_millis(80)).await;
        handle.abort();

        let calls = sub.calls.lock().unwrap();
        // Only the first submission should have fired (no drift trigger after).
        assert_eq!(
            calls.len(),
            1,
            "tiny drift below threshold should not trigger"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn drift_above_threshold_triggers_submission() {
        let src = Arc::new(MockSource::new());
        src.set_price("btc", dec!(100_000), 0);
        let sub = Arc::new(RecordingSubmitter::default());
        let cfg = RelayerConfig {
            feeds: vec!["btc".into()],
            poll_interval: Duration::from_millis(10),
            drift_bps: 5, // 0.05%
            heartbeat: Duration::from_secs(600),
        };
        let relayer = Relayer::new(src.clone(), sub.clone(), cfg);
        let handle = tokio::spawn(relayer.run());
        tokio::time::sleep(Duration::from_millis(40)).await;

        // Move price by 1% — well above 0.05%.
        src.set_price("btc", dec!(101_000), 1);
        tokio::time::sleep(Duration::from_millis(80)).await;
        handle.abort();

        let calls = sub.calls.lock().unwrap();
        assert!(
            calls.len() >= 2,
            "drift > threshold should trigger another submission"
        );
    }
}
