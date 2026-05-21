// Browser-side mock WebSocket server. Uses `mock-socket` to override the
// global WebSocket constructor so `new WebSocket("ws://localhost:8081")`
// connects to this simulated server instead of going over the network.

import { Server, type Client } from "mock-socket";
import {
  STATE,
  mutateBook,
  nowNs,
  nsStr,
  oraclePrice,
  refreshMarks,
  snapshotOf,
  spawnTrade,
} from "./data/seed";
import type { MarketId } from "@/lib/types/contract";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081";

let server: Server | null = null;
let intervals: ReturnType<typeof setInterval>[] = [];

interface ClientState {
  subs: Set<string>;
  socket: Client;
}

const clients = new Set<ClientState>();

function broadcast(channelFilter: (ch: string) => boolean, payload: object) {
  const data = JSON.stringify(payload);
  for (const c of clients) {
    for (const ch of c.subs) {
      if (channelFilter(ch)) {
        c.socket.send(data);
        break;
      }
    }
  }
}

function startSimulation() {
  // Orderbook deltas — every 100ms per market
  for (const marketId of STATE.markets.keys()) {
    intervals.push(
      setInterval(() => {
        const d = mutateBook(marketId);
        broadcast((ch) => ch === `orderbook.${marketId}`, {
          type: "delta",
          channel: `orderbook.${marketId}`,
          sequence: d.sequence,
          bids: d.bids,
          asks: d.asks,
          tsNs: d.tsNs,
        });
      }, 100)
    );

    // Trade tape — every 400-1200ms
    const scheduleTrade = () => {
      const wait = 400 + Math.random() * 800;
      intervals.push(
        setTimeout(() => {
          const t = spawnTrade(marketId);
          broadcast((ch) => ch === `trades.${marketId}`, {
            type: "trade",
            channel: `trades.${marketId}`,
            id: t.id,
            price: t.price,
            qty: t.qty,
            side: t.side,
            tsNs: t.tsNs,
          });
          scheduleTrade();
        }, wait) as unknown as ReturnType<typeof setInterval>
      );
    };
    scheduleTrade();

    // Oracle — every 500ms
    intervals.push(
      setInterval(() => {
        const price = oraclePrice(marketId);
        broadcast((ch) => ch === `oracle.${marketId}`, {
          type: "oracle",
          channel: `oracle.${marketId}`,
          priceX18: price,
          confidenceX18: "5.0",
          sourceTsNs: nsStr(nowNs()),
          tsNs: nsStr(nowNs()),
        });
        refreshMarks();
      }, 500)
    );

    // Funding — every 5s
    intervals.push(
      setInterval(() => {
        const m = STATE.markets.get(marketId)!;
        m.funding.currentRateBps += (Math.random() - 0.5) * 0.4;
        m.funding.currentRateBps = Math.max(-15, Math.min(15, m.funding.currentRateBps));
        broadcast((ch) => ch === `funding.${marketId}`, {
          type: "funding",
          channel: `funding.${marketId}`,
          currentRateBps: m.funding.currentRateBps,
          nextSettlementTsNs: nsStr(m.funding.nextSettlementTsNs),
          tsNs: nsStr(nowNs()),
        });
      }, 5_000)
    );
  }

  // Heartbeat
  intervals.push(
    setInterval(() => {
      const ping = JSON.stringify({ type: "ping", tsNs: nsStr(nowNs()) });
      for (const c of clients) c.socket.send(ping);
    }, 15_000)
  );
}

export function startMockWsServer(): void {
  if (server) return;
  server = new Server(WS_URL);

  server.on("connection", (socket) => {
    const state: ClientState = { subs: new Set(), socket };
    clients.add(state);

    socket.on("message", (raw) => {
      let msg: { op?: string; channel?: string; token?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.op === "subscribe" && msg.channel) {
        state.subs.add(msg.channel);
        // Send snapshot for orderbook channels
        if (msg.channel.startsWith("orderbook.")) {
          const marketId = msg.channel.slice("orderbook.".length) as MarketId;
          if (STATE.markets.has(marketId)) {
            const snap = snapshotOf(marketId);
            socket.send(
              JSON.stringify({
                type: "snapshot",
                channel: msg.channel,
                sequence: snap.sequence,
                bids: snap.bids,
                asks: snap.asks,
                tsNs: snap.tsNs,
              })
            );
          }
        }
      } else if (msg.op === "unsubscribe" && msg.channel) {
        state.subs.delete(msg.channel);
      }
    });

    socket.on("close", () => {
      clients.delete(state);
    });
  });

  startSimulation();
}

export function stopMockWsServer(): void {
  if (!server) return;
  for (const t of intervals) clearInterval(t as unknown as number);
  intervals = [];
  server.stop();
  server = null;
  clients.clear();
}
