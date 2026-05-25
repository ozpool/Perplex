//! Rolling realised-volatility window used by the strategy. Records `(timestamp, mid)`
//! samples, evicts anything older than the configured window, and computes the population
//! standard deviation of consecutive log-returns.
//!
//! Population (not sample) stdev keeps the formula stable when the window has just one
//! return; switching to N-1 would yield NaN/infinite spread on the first tick.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct VolWindow {
    samples: VecDeque<(Instant, f64)>,
    window: Duration,
}

impl VolWindow {
    pub fn new(window: Duration) -> Self {
        Self {
            samples: VecDeque::new(),
            window,
        }
    }

    pub fn record(&mut self, ts: Instant, mid: f64) {
        if mid <= 0.0 {
            return;
        }
        self.samples.push_back((ts, mid));
        let cutoff = ts.checked_sub(self.window);
        if let Some(cutoff) = cutoff {
            while let Some(&(t, _)) = self.samples.front() {
                if t < cutoff {
                    self.samples.pop_front();
                } else {
                    break;
                }
            }
        }
    }

    /// Population stdev of log-returns; returns 0.0 when there are fewer than two samples
    /// so the strategy's vol-penalty term degrades gracefully at startup.
    pub fn realised_vol(&self) -> f64 {
        if self.samples.len() < 2 {
            return 0.0;
        }
        let mut prev: Option<f64> = None;
        let mut returns = Vec::with_capacity(self.samples.len());
        for &(_, m) in &self.samples {
            if let Some(p) = prev {
                if p > 0.0 && m > 0.0 {
                    returns.push((m / p).ln());
                }
            }
            prev = Some(m);
        }
        if returns.is_empty() {
            return 0.0;
        }
        let mean = returns.iter().copied().sum::<f64>() / returns.len() as f64;
        let var = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
        var.sqrt()
    }

    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_samples_yields_zero_vol() {
        let w = VolWindow::new(Duration::from_secs(60));
        assert_eq!(w.realised_vol(), 0.0);
    }

    #[test]
    fn single_sample_yields_zero_vol() {
        let mut w = VolWindow::new(Duration::from_secs(60));
        w.record(Instant::now(), 100.0);
        assert_eq!(w.realised_vol(), 0.0);
    }

    #[test]
    fn constant_price_yields_zero_vol() {
        let mut w = VolWindow::new(Duration::from_secs(60));
        let t0 = Instant::now();
        for i in 0..10 {
            w.record(t0 + Duration::from_millis(i * 100), 100.0);
        }
        assert!(w.realised_vol().abs() < 1e-12);
    }

    #[test]
    fn alternating_returns_have_nonzero_vol() {
        let mut w = VolWindow::new(Duration::from_secs(60));
        let t0 = Instant::now();
        // 100, 101, 100, 101 → ~99.5 bps tick-to-tick stdev
        for (i, p) in [100.0_f64, 101.0, 100.0, 101.0].iter().enumerate() {
            w.record(t0 + Duration::from_millis(i as u64 * 100), *p);
        }
        let v = w.realised_vol();
        assert!(v > 0.0);
        assert!(v < 0.05);
    }

    #[test]
    fn samples_outside_window_are_evicted() {
        let mut w = VolWindow::new(Duration::from_secs(1));
        let t0 = Instant::now();
        w.record(t0, 100.0);
        w.record(t0 + Duration::from_millis(500), 101.0);
        // Advance 2s — first two should fall out.
        w.record(t0 + Duration::from_secs(2), 102.0);
        assert_eq!(w.sample_count(), 1);
    }

    #[test]
    fn negative_or_zero_mid_is_ignored() {
        let mut w = VolWindow::new(Duration::from_secs(60));
        let t0 = Instant::now();
        w.record(t0, 100.0);
        w.record(t0 + Duration::from_millis(100), 0.0); // dropped
        w.record(t0 + Duration::from_millis(200), -5.0); // dropped
        assert_eq!(w.sample_count(), 1);
    }
}
