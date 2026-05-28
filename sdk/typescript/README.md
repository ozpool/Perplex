# @ozpool/perplex-sdk

Typed REST + WebSocket client for the [Perplex](https://github.com/ozpool/Perplex) perpetuals exchange.

## Install

The SDK is published to **GitHub Packages** under the `@ozpool` scope. Configure npm to route `@ozpool/*` to GitHub Packages — your project's `.npmrc`:

```ini
@ozpool:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` needs the `read:packages` scope. Then:

```bash
npm install @ozpool/perplex-sdk
```

## Usage

```ts
import { PerplexClient } from "@ozpool/perplex-sdk";

const client = new PerplexClient({
  baseUrl: "https://edge.perplex.exchange",
  // bearer is optional — only required for /v1/orders, /v1/positions, etc.
  bearer: process.env.PERPLEX_JWT,
});

const markets = await client.markets();
console.log(markets);
```

WebSocket:

```ts
import { PerplexWs } from "@ozpool/perplex-sdk";

const ws = new PerplexWs({
  url: "wss://edge.perplex.exchange/ws",
  token: process.env.PERPLEX_JWT,
});

ws.on((msg) => {
  if (msg.type === "oracle") console.log(msg.priceX18);
});

ws.subscribe("oracle.btc-usd");
ws.connect();
```

## Channels

| Channel | Auth | Payload |
|---|---|---|
| `orderbook.{marketId}` | public | snapshot + deltas |
| `trades.{marketId}` | public | public fills |
| `oracle.{marketId}` | public | live Pyth Hermes ticks (~500ms) |
| `funding.{marketId}` | public | funding rate + next-settlement boundary |
| `user.fills` | bearer | private fills |
| `user.positions` | bearer | private position diffs |

## License

BUSL-1.1 — see the main repo for terms.
