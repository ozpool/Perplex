#!/usr/bin/env python3
"""Dev-only orderbook seeder.

Mints a dev JWT for the maker account, then posts a bid + ask ladder around
each market's mid price every POLL_MS milliseconds, cancelling the previous
batch first so the book stays fresh and doesn't grow without bound. Use this
when the full counterparty bot is unavailable but the FE still needs a quoted
book to take against.

Mid price comes from the edge's `/v1/markets` endpoint each tick, which means
the seeder follows whatever the oracle relayer is publishing (Pyth Hermes in
the default dev stack). If the edge is unreachable the previous mid is
re-used; that keeps the book up across transient edge restarts.

Env knobs:
  PERPLEX_EDGE_URL    default http://127.0.0.1:8080
  SEED_ACCOUNT        default 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (anvil #1)
  SEED_MARKETS        comma-separated market ids (default "btc-usd,eth-usd,sol-usd")
  SEED_MID_OVERRIDE   "<id>:<mid>,..." — pin a market's mid regardless of the
                       edge response. Optional; intended for deterministic tests.
  SEED_QTY            default 0.1  (innermost rung qty; grows by QTY_GROWTH each rung)
  SEED_SPREAD_BPS     default 25   (half-spread, one side of mid)
  SEED_SPREAD_STEP_BPS default 15  (step per ladder rung)
  SEED_LADDER_LEVELS  default 5
  POLL_MS             default 2000
"""
from __future__ import annotations

import json
import os
import signal
import sys
import time
import urllib.request
import urllib.error

EDGE = os.environ.get("PERPLEX_EDGE_URL", "http://127.0.0.1:8080")
# Default to anvil account #1. Anvil account #0 is the canonical "user wallet"
# in dev (MetaMask import / wagmi mock connector), so seeding from there would
# put both sides of every match on the same address. The edge's matcher has no
# self-trade prevention (perplex-matching does, but the edge has its own
# simpler matcher in state.rs), so a self-match upserts +qty long AND -qty
# short into the same position, netting to zero — fills tab populates but
# positions tab stays empty. Account #1 keeps the maker side cleanly separate.
ACCOUNT = os.environ.get("SEED_ACCOUNT", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
# Base size for the first (innermost) ladder rung. Each subsequent rung
# multiplies by QTY_GROWTH so the book densifies outward — small market
# orders fill at the tight inner spread, big sweeps walk into worse prices
# the way a real DEX feels. Inner rung is deliberately small (0.1 base
# units) so a typical demo size (0.2–2 BTC) walks at least two price
# levels — otherwise the VWAP collapses to the innermost ask and the
# liquidation preview reads as a flat number per leverage regardless of
# size, which looks broken. Ladder total with defaults: 0.1 + 0.2 + 0.4
# + 0.8 + 1.6 = 3.1 base units per side.
QTY = float(os.environ.get("SEED_QTY", "0.1"))
QTY_GROWTH = float(os.environ.get("SEED_QTY_GROWTH", "2"))
# Distance of the innermost level from mid, in basis points (one side).
# Each rung steps out by SPREAD_STEP_BPS so prices fan out monotonically.
SPREAD_BPS = float(os.environ.get("SEED_SPREAD_BPS", "25"))
SPREAD_STEP_BPS = float(os.environ.get("SEED_SPREAD_STEP_BPS", "15"))
# Number of price levels per side. Five is plenty to make the slippage
# preview meaningful without flooding the book.
LADDER_LEVELS = int(os.environ.get("SEED_LADDER_LEVELS", "5"))
POLL_MS = int(os.environ.get("POLL_MS", "2000"))
# Just market ids now — mids are pulled live from /v1/markets each tick so the
# ladder follows the oracle relayer (Pyth Hermes by default). Previous form
# accepted "<id>:<mid>" pairs but the hardcoded mids drifted hard from reality
# the instant the relayer landed (#160). For deterministic tests, set
# SEED_MID_OVERRIDE to pin specific markets.
MARKETS_RAW = os.environ.get("SEED_MARKETS", "btc-usd,eth-usd,sol-usd")
MID_OVERRIDE_RAW = os.environ.get("SEED_MID_OVERRIDE", "")
SIG = "0x" + "0" * 130


def _parse_market_ids(raw: str) -> list[str]:
    """Accept the legacy `<id>:<mid>` form too — keeps existing dev-up-all
    invocations working — but only consumes the id half. Mids come from
    the edge."""
    out: list[str] = []
    for chunk in raw.split(","):
        mid_id = chunk.split(":", 1)[0].strip()
        if mid_id:
            out.append(mid_id)
    return out


def _parse_mid_overrides(raw: str) -> dict[str, float]:
    out: dict[str, float] = {}
    if not raw:
        return out
    for chunk in raw.split(","):
        mid_id, _, mid_px = chunk.partition(":")
        mid_id = mid_id.strip()
        if not mid_id or not mid_px:
            continue
        try:
            out[mid_id] = float(mid_px)
        except ValueError:
            print(
                f"[seed-book] ignoring bad SEED_MID_OVERRIDE entry: {chunk!r}",
                flush=True,
            )
    return out


def fetch_mids(market_ids: list[str], overrides: dict[str, float]) -> dict[str, float]:
    """Pull `indexPriceX18` from /v1/markets for each requested marketId and
    descale to dollars. Returns empty dict on any error so the caller can
    fall back to the previous mids. Overrides win when present."""
    try:
        with urllib.request.urlopen(f"{EDGE}/v1/markets", timeout=5) as r:
            payload = json.load(r)
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
        print(f"[seed-book] /v1/markets fetch failed: {e!r}", flush=True)
        return {}
    except urllib.error.HTTPError as e:
        print(
            f"[seed-book] /v1/markets HTTP error: {e.code} {e.read().decode(errors='replace')}",
            flush=True,
        )
        return {}

    want = set(market_ids)
    out: dict[str, float] = {}
    for m in payload.get("markets", []):
        mid_id = m.get("id")
        if mid_id not in want:
            continue
        if mid_id in overrides:
            out[mid_id] = overrides[mid_id]
            continue
        raw_px = m.get("indexPriceX18")
        if not raw_px:
            continue
        try:
            # x18-scaled integer as a string -> dollars
            out[mid_id] = int(raw_px) / 1e18
        except (TypeError, ValueError):
            print(
                f"[seed-book] {mid_id}: unparseable indexPriceX18 {raw_px!r}",
                flush=True,
            )
    return out


def mint_token() -> str:
    """Block until the edge gives us a JWT. Used at boot and after any
    auth failure (e.g. edge process restarted and rolled its signing key,
    invalidating the bearer we were holding). Never raises — keeps
    retrying so the seeder can survive transient edge outages mid-demo."""
    backoff = 0.5
    while True:
        try:
            with urllib.request.urlopen(
                f"{EDGE}/__dev/token/{ACCOUNT}", timeout=5
            ) as r:
                return json.load(r)["jwt"]
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            print(
                f"[seed-book] mint_token retry after {e!r} (sleep {backoff:.1f}s)",
                flush=True,
            )
            time.sleep(backoff)
            backoff = min(backoff * 2, 10.0)


def post_order(token: str, market: str, side: str, price: float, qty: float, cid: str) -> str:
    """Returns the new order id, or empty string if the edge wasn't reachable.
    HTTPError (4xx/5xx with a body) is re-raised so the caller can read the
    server's response — network-level errors get swallowed and logged so a
    single dropped tick doesn't kill the whole seeder."""
    body = json.dumps(
        {
            "marketId": market,
            "side": side,
            "type": "limit",
            "price": f"{price:.2f}",
            "qty": f"{qty:.4f}",
            "timeInForce": "gtc",
            "reduceOnly": False,
            "postOnly": False,
            "clientOrderId": cid,
            "nonce": str(time.time_ns()),
            "signature": SIG,
        }
    ).encode()
    req = urllib.request.Request(
        f"{EDGE}/v1/orders",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)["orderId"]
    except urllib.error.HTTPError:
        # Let the caller handle 4xx/5xx — they need to read the body to
        # decide whether to retry, re-auth, or back off.
        raise
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
        print(f"[seed-book] post_order network error: {e!r}", flush=True)
        return ""


def cancel(token: str, order_id: str) -> None:
    """Best-effort cancel. Eats every network and HTTP error — a stale
    order id is harmless (404), and a transient connection refused during
    an edge restart must not kill the seeder process."""
    if not order_id:
        return
    req = urllib.request.Request(
        f"{EDGE}/v1/orders/{order_id}",
        method="DELETE",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except urllib.error.HTTPError:
        # Order already filled / cancelled — fine.
        pass
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
        # Edge is mid-restart or otherwise unreachable. The stale id is
        # gone for free when the edge wipes its in-memory book, so this
        # is safe to drop.
        print(f"[seed-book] cancel skipped ({e!r})", flush=True)


def main() -> int:
    market_ids = _parse_market_ids(MARKETS_RAW)
    if not market_ids:
        print(
            "[seed-book] SEED_MARKETS parsed empty; nothing to seed",
            flush=True,
        )
        return 1
    overrides = _parse_mid_overrides(MID_OVERRIDE_RAW)

    print(f"[seed-book] minting dev JWT for {ACCOUNT}", flush=True)
    token = mint_token()

    # Seed the mid cache from /v1/markets before the first tick so the very
    # first ladder lands at a sensible level. fetch_mids returns empty on
    # network failure; in that case we fall back to overrides only, and the
    # main loop will keep retrying.
    mids: dict[str, float] = fetch_mids(market_ids, overrides)
    for mid_id in market_ids:
        if mid_id not in mids and mid_id in overrides:
            mids[mid_id] = overrides[mid_id]
    print(
        f"[seed-book] token ok; laddering {LADDER_LEVELS} levels around "
        f"{', '.join(m + '@' + (f'{mids[m]:.4f}' if m in mids else 'pending') for m in market_ids)} every {POLL_MS}ms "
        f"(inner spread {SPREAD_BPS}bps, step {SPREAD_STEP_BPS}bps, "
        f"qty base {QTY} × {QTY_GROWTH})",
        flush=True,
    )

    last_ids: dict[str, list[str]] = {m: [] for m in market_ids}

    def shutdown(*_: object) -> None:
        print("[seed-book] shutting down", flush=True)
        for ids in last_ids.values():
            for oid in ids:
                cancel(token, oid)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    seq = 0
    while True:
        seq += 1
        # Refresh mids each tick so the ladder tracks the oracle. Cache the
        # previous value to survive transient edge restarts (fetch_mids
        # returns empty on network errors).
        fresh = fetch_mids(market_ids, overrides)
        for k, v in fresh.items():
            mids[k] = v
        for market in market_ids:
            mid = mids.get(market)
            if mid is None or mid <= 0:
                # No mid available yet — skip this market this tick instead
                # of posting at a bogus price. Will retry on the next loop.
                continue
            for oid in last_ids[market]:
                cancel(token, oid)
            posted: list[str] = []
            try:
                for lvl in range(LADDER_LEVELS):
                    # Each ladder rung walks one SPREAD_STEP_BPS further from
                    # mid, and grows qty by QTY_GROWTH. The closest rung is
                    # at SPREAD_BPS (half-spread); the outermost rung is at
                    # SPREAD_BPS + (LADDER_LEVELS - 1) * SPREAD_STEP_BPS.
                    half_bps = SPREAD_BPS + lvl * SPREAD_STEP_BPS
                    half = half_bps / 10000.0
                    bid_px = mid * (1 - half)
                    ask_px = mid * (1 + half)
                    qty = QTY * (QTY_GROWTH ** lvl)
                    bid_id = post_order(
                        token, market, "buy", bid_px, qty,
                        f"seed-{market}-bid-{seq}-{lvl}"
                    )
                    ask_id = post_order(
                        token, market, "sell", ask_px, qty,
                        f"seed-{market}-ask-{seq}-{lvl}"
                    )
                    if bid_id:
                        posted.append(bid_id)
                    if ask_id:
                        posted.append(ask_id)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode(errors="replace")
                print(f"[seed-book] {market} POST failed: {e.code} {err_body}", flush=True)
                # 401 / 403 means the edge restarted and our JWT is dead —
                # re-mint and keep going. Anything else (rate limit, bad
                # market id, etc) is fine to retry next tick.
                if e.code in (401, 403):
                    print("[seed-book] auth expired, re-minting JWT", flush=True)
                    token = mint_token()
                for oid in posted:
                    cancel(token, oid)
                last_ids[market] = []
                continue
            except Exception as e:
                # Catch-all so a single bad tick never kills the seeder
                # mid-demo. Examples: edge bound on the wrong port, DNS
                # blip, JSON decode failure on a partial response.
                print(f"[seed-book] {market} tick error: {e!r}", flush=True)
                for oid in posted:
                    cancel(token, oid)
                last_ids[market] = []
                continue
            last_ids[market] = posted
        print(f"[seed-book] tick {seq} posted ({LADDER_LEVELS} levels per side)", flush=True)
        time.sleep(POLL_MS / 1000)


if __name__ == "__main__":
    sys.exit(main())
