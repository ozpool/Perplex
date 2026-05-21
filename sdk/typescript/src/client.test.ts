// Unit tests run via `node --test --experimental-strip-types`. We stub fetch so the tests
// don't need a live edge server.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { PerplexApiError, PerplexClient } from "./client.ts";
import type { MarketsResponse } from "./types.ts";

function mkFetch(handler: (input: string, init: RequestInit) => Response | Promise<Response>) {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {}))) as unknown as typeof fetch;
}

describe("PerplexClient", () => {
  it("hits GET /v1/markets and parses the response", async () => {
    const body: MarketsResponse = {
      markets: [
        {
          id: "btc-usd",
          base: "BTC",
          quote: "USD",
          active: true,
          tickSize: "0.1",
          lotSize: "0.0001",
          maxLeverage: 20,
          imRatioBps: 500,
          mmRatioBps: 250,
          liqBonusBps: 100,
          takerFeeBps: 5,
          makerRebateBps: -2,
          fundingIntervalSec: 28800,
          indexPriceX18: "100000000000000000000000",
        },
      ],
    };
    const fetchImpl = mkFetch((url) => {
      assert.equal(url, "http://localhost:8080/v1/markets");
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const c = new PerplexClient({ baseUrl: "http://localhost:8080", fetchImpl });
    const got = await c.listMarkets();
    assert.equal(got.markets.length, 1);
    assert.equal(got.markets[0].id, "btc-usd");
  });

  it("attaches the bearer token on authed calls", async () => {
    let seenAuth: string | null = null;
    const fetchImpl = mkFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      seenAuth = headers["authorization"] ?? null;
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    });
    const c = new PerplexClient({ baseUrl: "http://localhost:8080", jwt: "abc", fetchImpl });
    await c.listOpenOrders();
    assert.equal(seenAuth, "Bearer abc");
  });

  it("maps a 429 response to PerplexApiError with retry-after", async () => {
    const fetchImpl = mkFetch(() =>
      new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", message: "rate limit exceeded" } }),
        { status: 429, headers: { "retry-after": "3" } },
      ),
    );
    const c = new PerplexClient({ baseUrl: "http://localhost:8080", fetchImpl });
    await assert.rejects(
      () => c.listMarkets(),
      (err) => {
        assert.ok(err instanceof PerplexApiError);
        assert.equal(err.status, 429);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(err.retryAfterSecs, 3);
        return true;
      },
    );
  });

  it("serialises place order request body", async () => {
    let seenBody: string | null = null;
    const fetchImpl = mkFetch((_url, init) => {
      seenBody = init.body as string;
      return new Response(
        JSON.stringify({ orderId: "ord_X", status: "accepted", tsNs: "1" }),
        { status: 200 },
      );
    });
    const c = new PerplexClient({ baseUrl: "http://localhost:8080", jwt: "j", fetchImpl });
    const res = await c.placeOrder({
      marketId: "btc-usd",
      side: "buy",
      type: "limit",
      price: "100000.0",
      qty: "0.1",
      timeInForce: "gtc",
      nonce: "1",
      signature: "0x" + "00".repeat(65),
    });
    assert.equal(res.orderId, "ord_X");
    const parsed = JSON.parse(seenBody!);
    assert.equal(parsed.marketId, "btc-usd");
    assert.equal(parsed.side, "buy");
  });

  it("siweVerify caches the returned jwt for subsequent authed calls", async () => {
    let authsSeen: string[] = [];
    const fetchImpl = mkFetch((url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (headers["authorization"]) authsSeen.push(headers["authorization"]);
      if (url.endsWith("/v1/auth/siwe/verify")) {
        return new Response(JSON.stringify({ jwt: "fresh-jwt", expiresAt: "1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    });
    const c = new PerplexClient({ baseUrl: "http://localhost:8080", fetchImpl });
    await c.siweVerify("msg", "0x" + "00".repeat(65));
    await c.listOpenOrders();
    assert.equal(authsSeen.length, 1);
    assert.equal(authsSeen[0], "Bearer fresh-jwt");
  });
});
