import { http, HttpResponse, delay } from "msw";
import {
  STATE,
  balanceFrame,
  fundingFrame,
  nowNs,
  nsStr,
  positionsFrame,
  pushFill,
  recentPublicTrades,
  refreshMarks,
  snapshotOf,
} from "./data/seed";
import type { Fill, MarketId, OpenOrder, OrderRequest } from "@/lib/types/contract";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function u(path: string) {
  return `${BASE}${path}`;
}

function known(marketId: string): marketId is MarketId {
  return marketId === "btc-usd" || marketId === "eth-usd" || marketId === "sol-usd";
}

export const handlers = [
  http.get(u("/v1/markets"), async () => {
    await delay(40);
    return HttpResponse.json({ markets: Array.from(STATE.markets.values()).map((m) => m.market) });
  }),

  http.get(u("/v1/orderbook/:marketId"), async ({ params }) => {
    const id = params.marketId as string;
    if (!known(id)) return HttpResponse.json({ error: { code: "MARKET_INACTIVE", message: id } }, { status: 404 });
    await delay(20);
    return HttpResponse.json(snapshotOf(id));
  }),

  http.get(u("/v1/trades/:marketId"), async ({ params, request }) => {
    const id = params.marketId as string;
    if (!known(id)) return HttpResponse.json({ error: { code: "MARKET_INACTIVE", message: id } }, { status: 404 });
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    await delay(30);
    const trades = recentPublicTrades(id, limit);
    const nextBefore = trades.length ? trades[trades.length - 1].tsNs : null;
    return HttpResponse.json({ trades, nextBefore });
  }),

  http.get(u("/v1/funding/:marketId"), async ({ params }) => {
    const id = params.marketId as string;
    if (!known(id)) return HttpResponse.json({ error: { code: "MARKET_INACTIVE", message: id } }, { status: 404 });
    await delay(30);
    return HttpResponse.json(fundingFrame(id));
  }),

  http.post(u("/v1/orders"), async ({ request }) => {
    const body = (await request.json()) as OrderRequest;
    if (!known(body.marketId))
      return HttpResponse.json({ error: { code: "MARKET_INACTIVE", message: body.marketId } }, { status: 400 });
    const orderId = `ord_${Math.random().toString(36).slice(2, 12)}`;
    const ts = nsStr(nowNs());
    const remaining = body.type === "market" ? "0" : body.qty;
    const order: OpenOrder = {
      id: orderId,
      marketId: body.marketId,
      side: body.side,
      type: body.type,
      price: body.price,
      qty: body.qty,
      remaining,
      tsNs: ts,
      clientOrderId: body.clientOrderId,
    };
    if (body.type === "limit") {
      STATE.openOrders = [order, ...STATE.openOrders];
    } else {
      // Market — immediate fill
      const fill: Fill = {
        id: `fill_${Math.random().toString(36).slice(2, 10)}`,
        orderId,
        marketId: body.marketId,
        side: body.side,
        price: body.price,
        qty: body.qty,
        feeUsdc: (Number(body.qty) * Number(body.price) * 0.0005).toFixed(2),
        role: "taker",
        tsNs: ts,
        txHash: `0x${Math.random().toString(16).slice(2, 10).padEnd(64, "0")}`,
      };
      pushFill(fill);
      // Apply naive position update — long if buy
      const m = STATE.markets.get(body.marketId)!;
      const existing = STATE.positions.find((p) => p.marketId === body.marketId);
      const dir = body.side === "buy" ? 1 : -1;
      const qty = Number(body.qty) * dir;
      if (existing) {
        const oldSize = Number(existing.size) * (existing.side === "long" ? 1 : -1);
        const newSize = oldSize + qty;
        if (Math.abs(newSize) < Number(m.market.lotSize)) {
          STATE.positions = STATE.positions.filter((p) => p.marketId !== body.marketId);
        } else {
          existing.size = Math.abs(newSize).toFixed(4);
          existing.side = newSize > 0 ? "long" : "short";
          existing.entryPriceX18 = body.price;
        }
      } else {
        STATE.positions.push({
          marketId: body.marketId,
          size: body.qty,
          side: body.side === "buy" ? "long" : "short",
          entryPriceX18: body.price,
          markPriceX18: body.price,
          notionalUsdc: (Number(body.price) * Number(body.qty)).toFixed(2),
          unrealisedPnlUsdc: "0.00",
          realisedPnlUsdc: "0.00",
          leverage: "2.0",
          liquidationPriceX18: (Number(body.price) * (body.side === "buy" ? 0.92 : 1.08)).toFixed(2),
          fundingPaidUsdc: "0.00",
          lastUpdatedTsNs: ts,
        });
      }
      refreshMarks();
    }
    await delay(60);
    return HttpResponse.json({ orderId, status: "accepted", tsNs: ts });
  }),

  http.delete(u("/v1/orders/:orderId"), async ({ params }) => {
    const id = params.orderId as string;
    STATE.openOrders = STATE.openOrders.filter((o) => o.id !== id);
    await delay(40);
    return HttpResponse.json({ orderId: id, status: "cancelled" });
  }),

  http.get(u("/v1/orders/open"), async () => {
    await delay(30);
    return HttpResponse.json({ orders: STATE.openOrders });
  }),

  http.get(u("/v1/positions"), async () => {
    refreshMarks();
    await delay(30);
    return HttpResponse.json(positionsFrame());
  }),

  http.get(u("/v1/fills"), async ({ request }) => {
    const url = new URL(request.url);
    const marketId = url.searchParams.get("marketId");
    const limit = Number(url.searchParams.get("limit") ?? 100);
    let fills = STATE.fills;
    if (marketId) fills = fills.filter((f) => f.marketId === marketId);
    const slice = fills.slice(0, limit);
    const nextBefore = slice.length ? slice[slice.length - 1].tsNs : null;
    await delay(30);
    return HttpResponse.json({ fills: slice, nextBefore });
  }),

  http.get(u("/v1/account/balance"), async () => {
    await delay(30);
    return HttpResponse.json(balanceFrame());
  }),

  http.post(u("/v1/auth/siwe/nonce"), async () => {
    const nonce = Math.random().toString(36).slice(2, 18);
    return HttpResponse.json({ nonce });
  }),

  http.post(u("/v1/auth/siwe/verify"), async () => {
    const jwt = `jwt_${Math.random().toString(36).slice(2, 20)}`;
    STATE.jwt = jwt;
    return HttpResponse.json({ jwt, expiresAt: nsStr(nowNs() + 3_600_000_000_000n) });
  }),
];
