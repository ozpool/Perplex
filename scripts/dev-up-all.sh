#!/usr/bin/env bash
# One-shot launcher for the full Perplex local stack.
#
# Brings up: anvil + postgres + redis (via docker) → contracts deployed and
# markets seeded → perplex-edge (REST + WS) → counterparty bot (quote agent) →
# Prometheus + Grafana → web frontend pointed at the live edge.
#
# Each long-lived process spawns its own Terminal.app window so logs stay
# readable. Run this once at the start of a demo, then drive the UI.
#
# Usage:
#   ./scripts/dev-up-all.sh
#
# Optional env overrides:
#   PERPLEX_REPO         repo root  (default: this file's grandparent)
#   PERPLEX_BOT_ACCOUNT  account address the bot signs as  (default: anvil #0)
#
# Tear down:
#   make dev-down     # stop anvil + postgres + redis (keep volumes)
#   make metrics-down # stop prometheus + grafana
#   make dev-reset    # nuke volumes and re-bootstrap

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${PERPLEX_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Anvil account #0 — keeps the bot's signer separate from the demo wallet
# (account #5) used in MetaMask. Both are pre-funded by `make dev-up`.
BOT_ACCOUNT="${PERPLEX_BOT_ACCOUNT:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

c_red()    { printf "\033[1;31m%s\033[0m\n" "$1"; }
c_green()  { printf "\033[1;32m%s\033[0m\n" "$1"; }
c_yellow() { printf "\033[1;33m%s\033[0m\n" "$1"; }
c_blue()   { printf "\033[1;34m%s\033[0m\n" "$1"; }

step() { c_blue "=== $1 ==="; }
ok()   { c_green "[ok] $1"; }
warn() { c_yellow "[warn] $1"; }
fail() { c_red "[fail] $1"; exit 1; }

# ----- preflight -----------------------------------------------------------
step "preflight"

[[ -d "$REPO" ]] || fail "repo not found at $REPO (override with PERPLEX_REPO=...)"
cd "$REPO"

command -v docker >/dev/null || fail "docker not on PATH"
docker info >/dev/null 2>&1 || fail "docker daemon not running — open Docker Desktop first"
ok "docker ok"

command -v cargo >/dev/null || fail "cargo not on PATH"
command -v pnpm  >/dev/null || fail "pnpm not on PATH"
command -v forge >/dev/null || fail "forge not on PATH"
command -v jq    >/dev/null || fail "jq not on PATH (brew install jq)"
ok "toolchains ok"

# Identity check — Perplex commits must come from ozpool.
if command -v gh >/dev/null 2>&1; then
  active="$(gh api user -q .login 2>/dev/null || true)"
  if [[ -n "$active" && "$active" != "ozpool" ]]; then
    warn "gh active account is '$active', not 'ozpool'. Run 'ghswitch ozpool' before committing."
  fi
fi

# Detect macOS — Terminal.app driver only works on darwin.
[[ "$(uname)" == "Darwin" ]] || fail "this script drives Terminal.app and only runs on macOS. On Linux, run each section by hand from the Notion runbook."

# ----- terminal opener -----------------------------------------------------
open_term() {
  # $1 = window title, $2 = command string
  local title="$1"
  local cmd="$2"
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "echo -ne '\\033]0;${title}\\007'; cd \"${REPO}\" && ${cmd}"
end tell
APPLESCRIPT
}

# ----- step 1: dev-up (blocking) -------------------------------------------
step "step 1/5  make dev-up   (foreground — waits for deploy + seed)"
make dev-up
ok "anvil + postgres + redis up; contracts deployed; wallets + market prices seeded"

# ----- step 2: perplex-edge in a new window --------------------------------
step "step 2/5  perplex-edge   (REST :8080, WS :8081)"
open_term "perplex-edge" \
"PERPLEX_JWT_SECRET=dev-secret cargo run -p perplex-edge -- --bind 127.0.0.1:8080 --ws-bind 127.0.0.1:8081"
ok "edge launching in a new Terminal window"

printf "waiting for edge "
edge_up=0
for _ in $(seq 1 60); do
  if curl -sf -m 1 http://127.0.0.1:8080/v1/markets >/dev/null 2>&1; then
    edge_up=1
    echo ""
    ok "edge is up"
    break
  fi
  printf "."
  sleep 1
done
[[ "$edge_up" -eq 1 ]] || fail "edge did not respond on :8080 within 60s — check the perplex-edge Terminal window"

# ----- step 3: mint JWT + start counterparty bot ---------------------------
step "step 3/5  perplex-cli quote   (counterparty bot)"

TOKEN="$(curl -s "http://127.0.0.1:8080/__dev/token/${BOT_ACCOUNT}" | jq -r '.jwt // empty')"

if [[ -z "$TOKEN" ]]; then
  warn "could not mint dev JWT — opening bot terminal with manual instructions"
  open_term "perplex-cli quote" \
"echo 'Mint a JWT then run the bot:'; \
 echo '  TOKEN=\$(curl -s http://127.0.0.1:8080/__dev/token/${BOT_ACCOUNT} | jq -r .jwt)'; \
 echo '  PERPLEX_DEV_ROUTES=true cargo run -p perplex-cli -- quote \\'; \
 echo '    --edge-url http://127.0.0.1:8080 \\'; \
 echo '    --markets btc-usd,eth-usd,sol-usd \\'; \
 echo '    --account ${BOT_ACCOUNT} \\'; \
 echo '    --bearer \\\"\\\$TOKEN\\\" \\'; \
 echo '    --metrics-bind 0.0.0.0:9100'; \
 exec \$SHELL"
else
  open_term "perplex-cli quote" \
"PERPLEX_DEV_ROUTES=true cargo run -p perplex-cli -- quote \
 --edge-url http://127.0.0.1:8080 \
 --markets btc-usd,eth-usd,sol-usd \
 --account ${BOT_ACCOUNT} \
 --bearer \"${TOKEN}\" \
 --metrics-bind 0.0.0.0:9100"
  ok "counterparty bot launching"
fi

# ----- step 4: metrics stack in a new window -------------------------------
step "step 4/5  prometheus + grafana"
open_term "perplex metrics" \
"make metrics-up && echo '' && echo 'Grafana:    http://localhost:3001' && echo 'Prometheus: http://localhost:9090' && exec \$SHELL"
ok "metrics stack launching"

# ----- step 5: frontend in a new window ------------------------------------
step "step 5/5  frontend  (dev:real — points at the live edge)"
open_term "perplex web:dev:real" "pnpm web:dev:real"
ok "frontend launching"

# ----- summary -------------------------------------------------------------
echo ""
c_green "================================================================"
c_green "  Perplex local stack is launching."
c_green ""
c_green "  Edge REST:   http://127.0.0.1:8080"
c_green "  Edge WS:     ws://127.0.0.1:8081"
c_green "  Frontend:    http://localhost:3000"
c_green "  Grafana:     http://localhost:3001  (admin / admin)"
c_green "  Prometheus:  http://localhost:9090"
c_green ""
c_green "  Demo wallet (anvil account #5 — import into MetaMask):"
c_green "    addr: 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
c_green "    pk:   0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
c_green ""
c_green "  Pre-demo checklist:"
c_green "    - edge window: tracing lines flowing, no panics"
c_green "    - bot window:  'computed quotes' logging per market"
c_green "    - book:        curl /v1/orderbook/btc-usd shows bids + asks"
c_green "    - frontend:    /markets renders 3 markets, /trade has a live book"
c_green ""
c_green "  Tear down:"
c_green "    Close the spawned Terminal windows, then in ${REPO}:"
c_green "      make dev-down     # stop anvil + postgres + redis"
c_green "      make metrics-down # stop prometheus + grafana"
c_green "================================================================"
