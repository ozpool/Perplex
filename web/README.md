Perplex — dark-mode perpetual futures trading UI for BTC, ETH, SOL. Six screens (Trade, Markets, Portfolio, History, Wallet), wagmi v3 wallet, EIP-712 order signing, optimistic order placement, MSW REST mocks, in-browser WebSocket mock for live orderbook/trades/oracle/funding. Bound to `api-contract.md`.

## Quickstart

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 — redirects to `/trade/btc-usd`. Mock backend boots in-browser (~200ms splash). Toggle via `.env.local`: `NEXT_PUBLIC_USE_MOCKS=0` points wagmi+wallet UI at real `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`.
