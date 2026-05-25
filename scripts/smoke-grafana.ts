/**
 * Phase 7 acceptance smoke for issue #45. Validates the Grafana dashboard JSON wire-up
 * without spinning up a real Prometheus + Grafana stack in CI (Compose file is for
 * operators; this script keeps the loop tight enough for the PR gate).
 *
 * Assertions:
 *   1. infra/grafana/counterparty.json parses and has uid `perplex-counterparty`.
 *   2. At least four panels covering the issue's required scope:
 *        - per-market PnL          (counterparty_realised_pnl_usdc)
 *        - total inventory         (counterparty_inventory)
 *        - quote-cancel rate       (counterparty_quote_cancels_total)
 *        - fill share vs volume    (counterparty_fills_total / counterparty_quote_places_total)
 *   3. Every metric referenced in any panel target's `expr` is a series the agent
 *      actually emits (cross-checked against EXPECTED_METRICS — keep in sync with
 *      crates/perplex-cli/src/metrics.rs::ALL_METRIC_NAMES).
 *   4. Each panel uses the Prometheus datasource uid.
 *
 * Exit 0 = all assertions pass. Non-zero = abort.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const EXPECTED_METRICS = new Set<string>([
  "counterparty_realised_pnl_usdc",
  "counterparty_inventory",
  "counterparty_realised_vol",
  "counterparty_spread_bps",
  "counterparty_skew_bps",
  "counterparty_quote_places_total",
  "counterparty_quote_cancels_total",
  "counterparty_fills_total",
  "counterparty_kill_trips_total",
]);

const REQUIRED_PANEL_METRICS: { label: string; metric: string }[] = [
  { label: "per-market PnL", metric: "counterparty_realised_pnl_usdc" },
  { label: "total inventory", metric: "counterparty_inventory" },
  { label: "quote-cancel rate", metric: "counterparty_quote_cancels_total" },
  { label: "fill share vs volume (fills)", metric: "counterparty_fills_total" },
  { label: "fill share vs volume (places)", metric: "counterparty_quote_places_total" },
];

interface Panel {
  id: number;
  title: string;
  datasource?: { type?: string; uid?: string };
  targets?: { expr?: string; datasource?: { uid?: string } }[];
}

interface Dashboard {
  uid?: string;
  title?: string;
  panels?: Panel[];
}

function fail(msg: string): never {
  console.error(`ASSERTION FAILED: ${msg}`);
  process.exit(1);
}

function metricsInExpr(expr: string): string[] {
  // Greedy match of `[a-z_]+` tokens followed by `{` or whitespace/end. Matches the
  // metric names the agent emits without false-positiving on label values.
  const out: string[] = [];
  const re = /([a-z_][a-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const tok = m[1]!;
    if (tok.startsWith("counterparty_")) out.push(tok);
  }
  return out;
}

function main(): void {
  const file = path.join(REPO_ROOT, "infra", "grafana", "counterparty.json");
  if (!fs.existsSync(file)) fail(`dashboard not found: ${file}`);

  const raw = fs.readFileSync(file, "utf-8");
  let dash: Dashboard;
  try {
    dash = JSON.parse(raw) as Dashboard;
  } catch (err) {
    fail(`dashboard JSON malformed: ${(err as Error).message}`);
  }

  if (dash.uid !== "perplex-counterparty") {
    fail(`expected uid="perplex-counterparty", got ${dash.uid}`);
  }
  if (!dash.panels || dash.panels.length < 4) {
    fail(`dashboard must have at least 4 panels, found ${dash.panels?.length ?? 0}`);
  }

  const referencedMetrics = new Set<string>();
  for (const panel of dash.panels) {
    if (!panel.targets || panel.targets.length === 0) {
      fail(`panel ${panel.id} (${panel.title}) has no targets`);
    }
    for (const t of panel.targets) {
      if (!t.expr) fail(`panel ${panel.id} target missing expr`);
      const uid = t.datasource?.uid ?? panel.datasource?.uid;
      if (uid !== "prometheus") {
        fail(`panel ${panel.id} target uses datasource uid=${uid}, expected prometheus`);
      }
      for (const m of metricsInExpr(t.expr)) referencedMetrics.add(m);
    }
  }

  for (const required of REQUIRED_PANEL_METRICS) {
    if (!referencedMetrics.has(required.metric)) {
      fail(`required ${required.label} panel missing — no panel references ${required.metric}`);
    }
  }

  for (const m of referencedMetrics) {
    if (!EXPECTED_METRICS.has(m)) {
      fail(
        `dashboard references metric '${m}' which the agent does not emit. Keep ` +
          `scripts/smoke-grafana.ts and crates/perplex-cli/src/metrics.rs in sync.`,
      );
    }
  }

  console.log(`grafana dashboard ok: ${dash.panels.length} panels, ` +
    `${referencedMetrics.size} metric series referenced.`);
  for (const required of REQUIRED_PANEL_METRICS) {
    console.log(`  [ok] ${required.label.padEnd(32)} -> ${required.metric}`);
  }
}

main();
