// Mirror of api-contract.md v1.1 — do not deviate. Numeric strings = decimal.

export type MarketId = "btc-usd" | "eth-usd" | "sol-usd";
export type Side = "buy" | "sell";
export type PositionSide = "long" | "short";
export type OrderType = "market" | "limit";
export type TimeInForce = "gtc" | "ioc" | "fok";
export type FillRole = "maker" | "taker";
export type OrderStatus = "accepted" | "rejected" | "cancelled" | "filled" | "partially_filled" | "expired";

export interface Market {
  id: MarketId;
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
  markets: Market[];
}

export type OrderbookLevel = [price: string, qty: string];

export interface OrderbookSnapshot {
  marketId: MarketId;
  sequence: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  tsNs: string;
}

export interface PublicTrade {
  id: string;
  marketId: MarketId;
  price: string;
  qty: string;
  side: Side;
  tsNs: string;
}

export interface TradesResponse {
  trades: PublicTrade[];
  nextBefore: string | null;
}

export interface FundingPoint {
  tsNs: string;
  rateBps: number;
}

export interface FundingResponse {
  marketId: MarketId;
  currentRateBps: number;
  nextSettlementTsNs: string;
  history: FundingPoint[];
}

export interface OrderRequest {
  marketId: MarketId;
  side: Side;
  type: OrderType;
  price: string;
  qty: string;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
  postOnly: boolean;
  clientOrderId: string;
  nonce: string;
  signature: string;
}

export interface OrderAck {
  orderId: string;
  status: "accepted";
  tsNs: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

export interface OpenOrder {
  id: string;
  marketId: MarketId;
  side: Side;
  type: OrderType;
  price: string;
  qty: string;
  remaining: string;
  tsNs: string;
  clientOrderId?: string;
}

export interface OpenOrdersResponse {
  orders: OpenOrder[];
}

export interface Position {
  marketId: MarketId;
  size: string;
  side: PositionSide;
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
  positions: Position[];
}

export interface Fill {
  id: string;
  orderId: string;
  marketId: MarketId;
  side: Side;
  price: string;
  qty: string;
  feeUsdc: string;
  role: FillRole;
  tsNs: string;
  txHash: string;
}

export interface FillsResponse {
  fills: Fill[];
  nextBefore: string | null;
}

export interface SiweNonceResponse {
  nonce: string;
}

export interface SiweVerifyResponse {
  jwt: string;
  expiresAt: string;
}

export interface PendingTransfer {
  id: string;
  amountUsdc: string;
  txHash: string;
  tsNs: string;
}

export interface BalanceResponse {
  vaultBalanceUsdc: string;
  walletUsdcBalance: string;
  pendingDeposits: PendingTransfer[];
  pendingWithdrawals: PendingTransfer[];
}

// ── WebSocket message envelopes ───────────────────────────────────────────────

export type WsOutbound =
  | { op: "subscribe"; channel: string }
  | { op: "unsubscribe"; channel: string }
  | { op: "auth"; token: string }
  | { op: "pong" };

export interface WsPing {
  type: "ping";
  tsNs: string;
}

export interface WsOrderbookSnapshot {
  type: "snapshot";
  channel: string;
  sequence: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  tsNs: string;
}

export interface WsOrderbookDelta {
  type: "delta";
  channel: string;
  sequence: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  tsNs: string;
}

export interface WsTrade {
  type: "trade";
  channel: string;
  id: string;
  price: string;
  qty: string;
  side: Side;
  tsNs: string;
}

export interface WsOracle {
  type: "oracle";
  channel: string;
  priceX18: string;
  confidenceX18: string;
  sourceTsNs: string;
  tsNs: string;
}

export interface WsFunding {
  type: "funding";
  channel: string;
  currentRateBps: number;
  nextSettlementTsNs: string;
  tsNs: string;
}

export type WsAccountMessage =
  | { type: "order.accepted"; orderId: string; marketId: MarketId; tsNs: string }
  | { type: "order.cancelled"; orderId: string; tsNs: string }
  | {
      type: "order.filled";
      orderId: string;
      fillId: string;
      marketId: MarketId;
      price: string;
      qty: string;
      remaining: string;
      feeUsdc: string;
      role: FillRole;
      tsNs: string;
    }
  | {
      type: "position.update";
      marketId: MarketId;
      size: string;
      entryPriceX18: string;
      unrealisedPnlUsdc: string;
      tsNs: string;
    }
  | { type: "liquidation.warning"; marketId: MarketId; healthFactor: string; tsNs: string }
  | { type: "liquidation.executed"; marketId: MarketId; size: string; price: string; tsNs: string }
  | { type: "funding.applied"; marketId: MarketId; amountUsdc: string; tsNs: string };

export type WsMessage =
  | WsPing
  | WsOrderbookSnapshot
  | WsOrderbookDelta
  | WsTrade
  | WsOracle
  | WsFunding
  | WsAccountMessage;
