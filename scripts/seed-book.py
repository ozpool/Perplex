#!/usr/bin/env python3
"""Dev-only orderbook seeder.

Mints a dev JWT for the maker account, then posts a bid + ask around each
market's mid price every POLL_MS milliseconds, cancelling the previous pair
first so the book stays fresh and doesn't grow without bound. Use this when
the full counterparty bot is unavailable but the FE still needs a quoted
book to take against.

Env knobs:
  PERPLEX_EDGE_URL   default http://127.0.0.1:8080
  SEED_ACCOUNT       default 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  SEED_MARKETS       "btc-usd:100000,eth-usd:3500,sol-usd:200" (default)
  SEED_QTY           default 0.05
  SEED_SPREAD_BPS    default 50  (25 bps each side of mid)
  POLL_MS            default 2000
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
# 0.05 was just enough to prove the matching engine wired up end-to-end, but
# meant a user typing any realistic size (e.g. 5 BTC) only got 0.05 filled and
# the rest dropped by the market-order leftover policy. 100 covers any
# reasonable demo entry without making the book look silly — the edge's
# margin check (not the seeder) is what bounds what a wallet can actually
# take down.
QTY = os.environ.get("SEED_QTY", "100")
SPREAD_BPS = float(os.environ.get("SEED_SPREAD_BPS", "50"))
POLL_MS = int(os.environ.get("POLL_MS", "2000"))
MARKETS_RAW = os.environ.get(
    "SEED_MARKETS", "btc-usd:100000,eth-usd:3500,sol-usd:200"
)
SIG = "0x" + "0" * 130


def mint_token() -> str:
    with urllib.request.urlopen(f"{EDGE}/__dev/token/{ACCOUNT}", timeout=5) as r:
        return json.load(r)["jwt"]


def post_order(token: str, market: str, side: str, price: float, cid: str) -> str:
    body = json.dumps(
        {
            "marketId": market,
            "side": side,
            "type": "limit",
            "price": f"{price:.2f}",
            "qty": QTY,
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
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.load(r)["orderId"]


def cancel(token: str, order_id: str) -> None:
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


def main() -> int:
    markets: list[tuple[str, float]] = []
    for raw in MARKETS_RAW.split(","):
        mid_str, _, mid_px = raw.partition(":")
        markets.append((mid_str.strip(), float(mid_px)))

    print(f"[seed-book] minting dev JWT for {ACCOUNT}", flush=True)
    token = mint_token()
    print(
        f"[seed-book] token ok; posting around "
        f"{', '.join(f'{m}@{p}' for m, p in markets)} "
        f"every {POLL_MS}ms (spread {SPREAD_BPS}bps, qty {QTY})",
        flush=True,
    )

    last_ids: dict[str, list[str]] = {m: [] for m, _ in markets}

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
        for market, mid in markets:
            half = SPREAD_BPS / 10000 / 2
            bid_px = mid * (1 - half)
            ask_px = mid * (1 + half)
            for oid in last_ids[market]:
                cancel(token, oid)
            try:
                bid_id = post_order(
                    token, market, "buy", bid_px, f"seed-{market}-bid-{seq}"
                )
                ask_id = post_order(
                    token, market, "sell", ask_px, f"seed-{market}-ask-{seq}"
                )
            except urllib.error.HTTPError as e:
                err_body = e.read().decode(errors="replace")
                print(f"[seed-book] {market} POST failed: {e.code} {err_body}", flush=True)
                last_ids[market] = []
                continue
            last_ids[market] = [bid_id, ask_id]
        print(f"[seed-book] tick {seq} posted", flush=True)
        time.sleep(POLL_MS / 1000)


if __name__ == "__main__":
    sys.exit(main())
