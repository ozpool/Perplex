// k6 mixed-workload load test for the Perplex edge.
//
// Targets per issue #36 acceptance:
//   - 5000 concurrent WebSocket subscribers across 3 markets
//   - 2000 orders/sec sustained for 5 minutes
//   - p99 order-to-ack < 30 ms
//
// Run:
//   k6 run -e EDGE_URL=http://localhost:8080 -e EDGE_WS_URL=ws://localhost:8081 scripts/load/k6-rest-and-ws.js
//
// Requires k6 v0.50+ (has the experimental websocket API).

import http from "k6/http";
import ws from "k6/ws";
import { Trend } from "k6/metrics";
import { check } from "k6";

const EDGE = __ENV.EDGE_URL || "http://localhost:8080";
const WS_EDGE = __ENV.EDGE_WS_URL || "ws://localhost:8081";

const MARKETS = ["btc-usd", "eth-usd", "sol-usd"];
const orderAckLatency = new Trend("order_ack_ms", true);

export const options = {
  scenarios: {
    websockets: {
      executor: "ramping-vus",
      exec: "wsSubscriber",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1000 },
        { duration: "30s", target: 5000 },
        { duration: "5m", target: 5000 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
    orders: {
      executor: "constant-arrival-rate",
      exec: "placeOrder",
      rate: 2000,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 200,
      maxVUs: 1000,
      startTime: "60s", // wait for the WS fleet to settle before generating order load
    },
  },
  thresholds: {
    "order_ack_ms": ["p(99)<30"],
    "http_req_failed{scenario:orders}": ["rate<0.01"],
  },
};

// Each WS VU connects, subscribes to one market's orderbook + trades, and idles.
export function wsSubscriber() {
  const market = MARKETS[__VU % MARKETS.length];
  const url = WS_EDGE;
  const res = ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      socket.send(JSON.stringify({ op: "subscribe", channel: `orderbook.${market}` }));
      socket.send(JSON.stringify({ op: "subscribe", channel: `trades.${market}` }));
    });
    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "ping") socket.send(JSON.stringify({ op: "pong" }));
      } catch {
        // ignore bad frames
      }
    });
    socket.setTimeout(() => socket.close(), 4 * 60 * 1000);
  });
  check(res, { "ws status 101": (r) => r && r.status === 101 });
}

// Pre-shared JWT for the order placer. Set EDGE_JWT or fall back to the dev token endpoint.
function devToken(address) {
  const res = http.get(`${EDGE}/__dev/token/${address}`);
  if (res.status !== 200) return null;
  const raw = res.body.toString().trim();
  return raw.replace(/^Bearer /, "");
}

const FALLBACK_JWT = __ENV.EDGE_JWT || devToken("0x000000000000000000000000000000000000aBcD");

export function placeOrder() {
  const market = MARKETS[__ITER % MARKETS.length];
  const body = JSON.stringify({
    marketId: market,
    side: __ITER % 2 === 0 ? "buy" : "sell",
    type: "limit",
    price: "100000.0",
    qty: "0.001",
    timeInForce: "ioc",
    nonce: String(Date.now()) + String(__ITER),
    signature: "0x" + "00".repeat(65),
  });
  const t0 = Date.now();
  const res = http.post(`${EDGE}/v1/orders`, body, {
    headers: { "content-type": "application/json", authorization: `Bearer ${FALLBACK_JWT}` },
  });
  orderAckLatency.add(Date.now() - t0);
  check(res, { "order accepted": (r) => r.status === 200 });
}
