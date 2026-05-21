// Wire types — mirror api-contract.md sections 1.1-1.11 exactly. Numeric values are decimal
// strings (never floats); timestamps are unix nanoseconds as strings.

export interface MarketInfo {
  id: string;
  base: string;
  quote: string;
  active: boolean;
  tickSize: string;
  lotSize: string;
  maxLeverage: number;
  imRatioBps: number;
  mmRatioBps: number;
  liqBonusBps: number;
  takerFeeBps: number;
  makerRebateBps: number;
  fundingIntervalSec: number;
  indexPriceX18: string;
}

export interface MarketsResponse {
  markets: MarketInfo[];
}

export interface OrderbookSnapshot {
  marketId: string;
  sequence: number;
  bids: [string, string][];
  asks: [string, string][];
  tsNs: string;
}

export interface PublicTrade {
  id: string;
  marketId: string;
  price: string;
  qty: string;
  side: "buy" | "sell";
  tsNs: string;
}

export interface TradesResponse {
  trades: PublicTrade[];
  nextBefore: string | null;
}

export interface FundingHistoryPoint {
  tsNs: string;
  rateBps: number;
}

export interface FundingResponse {
  marketId: string;
  currentRateBps: number;
  nextSettlementTsNs: string;
  history: FundingHistoryPoint[];
}

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";
export type TimeInForce = "gtc" | "ioc" | "fok";

export interface PlaceOrderRequest {
  marketId: string;
  side: Side;
  type: OrderType;
  price?: string;
  qty: string;
  timeInForce: TimeInForce;
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
  nonce: string;
  signature: string;
}

export interface PlaceOrderResponse {
  orderId: string;
  status: string;
  tsNs: string;
}

export interface CancelOrderResponse {
  orderId: string;
  status: string;
}

export interface OpenOrder {
  id: string;
  marketId: string;
  side: Side;
  type: OrderType;
  price: string;
  qty: string;
  remaining: string;
  tsNs: string;
  clientOrderId: string | null;
}

export interface OpenOrdersResponse {
  orders: OpenOrder[];
}

export interface PositionInfo {
  marketId: string;
  size: string;
  side: "long" | "short";
  entryPriceX18: string;
  markPriceX18: string;
  notionalUsdc: string;
  unrealisedPnlUsdc: string;
  realisedPnlUsdc: string;
  leverage: string;
  liquidationPriceX18: string;
  fundingPaidUsdc: string;
  lastUpdatedTsNs: string;
}

export interface PositionsResponse {
  collateralUsdc: string;
  freeCollateralUsdc: string;
  totalUnrealisedPnlUsdc: string;
  totalNotionalUsdc: string;
  positions: PositionInfo[];
}

export interface FillInfo {
  id: string;
  orderId: string;
  marketId: string;
  side: Side;
  price: string;
  qty: string;
  feeUsdc: string;
  role: "taker" | "maker";
  tsNs: string;
  txHash: string;
}

export interface FillsResponse {
  fills: FillInfo[];
  nextBefore: string | null;
}

export interface SiweNonceResponse {
  nonce: string;
}

export interface SiweVerifyResponse {
  jwt: string;
  expiresAt: string;
}

export interface BalanceResponse {
  vaultBalanceUsdc: string;
  walletUsdcBalance: string;
  pendingDeposits: unknown[];
  pendingWithdrawals: unknown[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}
