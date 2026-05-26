import type {
  BalanceResponse,
  FillsResponse,
  FundingResponse,
  MarketId,
  MarketsResponse,
  OpenOrdersResponse,
  OrderAck,
  OrderRequest,
  OrderbookSnapshot,
  PositionsResponse,
  SiweNonceResponse,
  SiweVerifyResponse,
  TradesResponse,
} from "@/lib/types/contract";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const BASE = API_BASE;

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const jwt = window.localStorage.getItem("perplex.jwt");
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const err = new Error(`API ${res.status}: ${res.statusText}`) as Error & { status: number; detail?: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  markets: () => request<MarketsResponse>("/v1/markets"),

  orderbook: (marketId: MarketId, depth: 50 | 200 | "full" = 50) =>
    request<OrderbookSnapshot>(`/v1/orderbook/${marketId}?depth=${depth}`),

  trades: (marketId: MarketId, limit = 100, before?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before) q.set("before", before);
    return request<TradesResponse>(`/v1/trades/${marketId}?${q.toString()}`);
  },

  funding: (marketId: MarketId, range: "1h" | "24h" | "7d" = "24h") =>
    request<FundingResponse>(`/v1/funding/${marketId}?range=${range}`),

  placeOrder: (body: OrderRequest) =>
    request<OrderAck>("/v1/orders", { method: "POST", body: JSON.stringify(body) }),

  cancelOrder: (orderId: string) =>
    request<{ orderId: string; status: "cancelled" }>(`/v1/orders/${orderId}`, { method: "DELETE" }),

  openOrders: () => request<OpenOrdersResponse>("/v1/orders/open"),

  positions: () => request<PositionsResponse>("/v1/positions"),

  fills: (params: { marketId?: MarketId; limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.marketId) q.set("marketId", params.marketId);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.before) q.set("before", params.before);
    const qs = q.toString();
    return request<FillsResponse>(`/v1/fills${qs ? `?${qs}` : ""}`);
  },

  balance: () => request<BalanceResponse>("/v1/account/balance"),

  siweNonce: (address: string) =>
    request<SiweNonceResponse>("/v1/auth/siwe/nonce", { method: "POST", body: JSON.stringify({ address }) }),

  siweVerify: (message: string, signature: string) =>
    request<SiweVerifyResponse>("/v1/auth/siwe/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    }),
};
