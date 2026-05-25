//! Per-market kill switch. When the running realised PnL for a market drops below
//! `-kill_threshold_usdc`, the switch trips: the agent cancels all open quotes for that
//! market and stops placing new ones until an operator manually resets it.
//!
//! Tripping is one-way by design — auto-recovery on transient PnL bounces would defeat
//! the purpose. Operators reset via `cli::kill::reset()` after auditing the cause.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct KillSwitch {
    /// Negative-or-zero threshold expressed as USDC. The switch trips when
    /// `realised_pnl < -kill_threshold_usdc`.
    threshold_usdc: f64,
    tripped: Arc<AtomicBool>,
}

impl KillSwitch {
    pub fn new(threshold_usdc: f64) -> Self {
        assert!(
            threshold_usdc >= 0.0,
            "kill threshold must be non-negative; was {threshold_usdc}"
        );
        Self {
            threshold_usdc,
            tripped: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Feed the latest realised-PnL reading. Returns `true` iff the switch is *now*
    /// tripped (whether by this call or a prior one).
    pub fn observe(&self, realised_pnl_usdc: f64) -> bool {
        if !self.is_tripped() && realised_pnl_usdc < -self.threshold_usdc {
            // Race: if two callers cross the threshold simultaneously we may both set it
            // to true, which is fine — set-true is idempotent and order doesn't matter.
            self.tripped.store(true, Ordering::SeqCst);
        }
        self.is_tripped()
    }

    pub fn is_tripped(&self) -> bool {
        self.tripped.load(Ordering::SeqCst)
    }

    pub fn reset(&self) {
        self.tripped.store(false, Ordering::SeqCst);
    }

    pub fn threshold_usdc(&self) -> f64 {
        self.threshold_usdc
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_switch_is_not_tripped() {
        let k = KillSwitch::new(500.0);
        assert!(!k.is_tripped());
    }

    #[test]
    fn pnl_above_negative_threshold_does_not_trip() {
        let k = KillSwitch::new(500.0);
        assert!(!k.observe(0.0));
        assert!(!k.observe(-499.99));
        assert!(!k.observe(100.0));
    }

    #[test]
    fn pnl_below_negative_threshold_trips() {
        let k = KillSwitch::new(500.0);
        assert!(k.observe(-500.01));
        assert!(k.is_tripped());
    }

    #[test]
    fn trip_is_sticky_until_reset() {
        let k = KillSwitch::new(500.0);
        k.observe(-600.0);
        // Even a healthy reading does not flip back on its own.
        assert!(k.observe(100.0));
        k.reset();
        assert!(!k.is_tripped());
    }

    #[test]
    #[should_panic(expected = "kill threshold must be non-negative")]
    fn negative_threshold_rejected() {
        KillSwitch::new(-1.0);
    }
}
