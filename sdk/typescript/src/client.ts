// REST client — manually written to stay 1:1 with api-contract.md. The OpenAPI doc is also
// served by perplex-edge at /docs/openapi.json for code-generated alternatives.

import type {
  BalanceResponse,
  CancelOrderResponse,
  FillsResponse,
  FundingResponse,
  MarketsResponse,
  OpenOrdersResponse,
  OrderbookSnapshot,
  PlaceOrderRequest,
  PlaceOrderResponse,
  PositionsResponse,
  SiweNonceResponse,
  SiweVerifyResponse,
  TradesResponse,
} from "./types.ts";

export interface PerplexClientConfig {
  baseUrl: string; // e.g. "http://localhost:8080"
  jwt?: string;
  fetchImpl?: typeof fetch;
}

export class PerplexApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSecs: number | null;
  constructor(status: number, code: string, message: string, retryAfter: number | null) {
    super(message);
    this.name = "PerplexApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSecs = retryAfter;
  }
}

export class PerplexClient {
  private readonly baseUrl: string;
  private jwt: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: PerplexClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.jwt = cfg.jwt;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  setJwt(jwt: string | undefined) {
    this.jwt = jwt;
  }

  // -- public ----------------------------------------------------------------

  listMarkets(): Promise<MarketsResponse> {
    return this.request<MarketsResponse>("GET", "/v1/markets");
  }

  getOrderbook(marketId: string, depth: 50 | 200 | "full" = 50): Promise<OrderbookSnapshot> {
    return this.request<OrderbookSnapshot>(
      "GET",
      `/v1/orderbook/${encodeURIComponent(marketId)}?depth=${depth}`,
    );
  }

  getTrades(marketId: string, opts: { limit?: number; before?: string } = {}): Promise<TradesResponse> {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.before != null) q.set("before", opts.before);
    return this.request<TradesResponse>("GET", `/v1/trades/${encodeURIComponent(marketId)}?${q}`);
  }

  getFunding(marketId: string, range: "1h" | "24h" | "7d" = "24h"): Promise<FundingResponse> {
    return this.request<FundingResponse>(
      "GET",
      `/v1/funding/${encodeURIComponent(marketId)}?range=${range}`,
    );
  }

  // -- siwe ------------------------------------------------------------------

  siweNonce(address: string): Promise<SiweNonceResponse> {
    return this.request<SiweNonceResponse>("POST", "/v1/auth/siwe/nonce", { address });
  }

  async siweVerify(message: string, signature: string): Promise<SiweVerifyResponse> {
    const res = await this.request<SiweVerifyResponse>("POST", "/v1/auth/siwe/verify", {
      message,
      signature,
    });
    this.jwt = res.jwt;
    return res;
  }

  // -- authed ----------------------------------------------------------------

  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.request<PlaceOrderResponse>("POST", "/v1/orders", req);
  }

  cancelOrder(orderId: string): Promise<CancelOrderResponse> {
    return this.request<CancelOrderResponse>("DELETE", `/v1/orders/${encodeURIComponent(orderId)}`);
  }

  listOpenOrders(): Promise<OpenOrdersResponse> {
    return this.request<OpenOrdersResponse>("GET", "/v1/orders/open");
  }

  listPositions(): Promise<PositionsResponse> {
    return this.request<PositionsResponse>("GET", "/v1/positions");
  }

  listFills(opts: { marketId?: string; limit?: number; before?: string } = {}): Promise<FillsResponse> {
    const q = new URLSearchParams();
    if (opts.marketId) q.set("marketId", opts.marketId);
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.before != null) q.set("before", opts.before);
    return this.request<FillsResponse>("GET", `/v1/fills?${q}`);
  }

  getBalance(): Promise<BalanceResponse> {
    return this.request<BalanceResponse>("GET", "/v1/account/balance");
  }

  // -- internals -------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.jwt) headers["authorization"] = `Bearer ${this.jwt}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let code = "HTTP_ERROR";
      let message = `request failed: ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { code: string; message: string } };
        if (j.error) {
          code = j.error.code;
          message = j.error.message;
        }
      } catch {
        // body wasn't JSON; keep the defaults.
      }
      const retry = res.headers.get("retry-after");
      throw new PerplexApiError(
        res.status,
        code,
        message,
        retry != null ? Number.parseInt(retry, 10) : null,
      );
    }
    return (await res.json()) as T;
  }
}
