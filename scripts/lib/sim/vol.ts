/**
 * Rolling realised-volatility window, ported from `crates/perplex-cli/src/vol.rs`.
 * Population stdev of consecutive log-returns; returns 0 when fewer than two samples.
 */

interface Sample {
  tsMs: number;
  mid: number;
}

export class VolWindow {
  private readonly samples: Sample[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  record(tsMs: number, mid: number): void {
    if (mid <= 0) return;
    this.samples.push({ tsMs, mid });
    const cutoff = tsMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.tsMs < cutoff) {
      this.samples.shift();
    }
  }

  realisedVol(): number {
    if (this.samples.length < 2) return 0;
    const returns: number[] = [];
    let prev: number | null = null;
    for (const s of this.samples) {
      if (prev !== null && prev > 0 && s.mid > 0) {
        returns.push(Math.log(s.mid / prev));
      }
      prev = s.mid;
    }
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }
}
