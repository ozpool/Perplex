//! Wire types — exactly the shapes the FE expects per api-contract.md. Numeric values are
//! always decimal strings to avoid IEEE-754 drift when crossing the JSON boundary.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MarketInfo {
    pub id: String,
    pub base: String,
    pub quote: String,
    pub active: bool,
    #[serde(rename = "tickSize")]
    pub tick_size: String,
    #[serde(rename = "lotSize")]
    pub lot_size: String,
    #[serde(rename = "maxLeverage")]
    pub max_leverage: u32,
    #[serde(rename = "imRatioBps")]
    pub im_ratio_bps: u16,
    #[serde(rename = "mmRatioBps")]
    pub mm_ratio_bps: u16,
    #[serde(rename = "liqBonusBps")]
    pub liq_bonus_bps: u16,
    #[serde(rename = "takerFeeBps")]
    pub taker_fee_bps: u16,
    #[serde(rename = "makerRebateBps")]
    pub maker_rebate_bps: i16,
    #[serde(rename = "fundingIntervalSec")]
    pub funding_interval_sec: u32,
    #[serde(rename = "indexPriceX18")]
    pub index_price_x18: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MarketsResponse {
    pub markets: Vec<MarketInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OrderbookSnapshot {
    #[serde(rename = "marketId")]
    pub market_id: String,
    pub sequence: u64,
    /// Each entry: `[priceX18AsDecimalString, qtyAsDecimalString]`.
    pub bids: Vec<[String; 2]>,
    pub asks: Vec<[String; 2]>,
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PublicTrade {
    pub id: String,
    #[serde(rename = "marketId")]
    pub market_id: String,
    pub price: String,
    pub qty: String,
    /// "buy" or "sell".
    pub side: String,
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TradesResponse {
    pub trades: Vec<PublicTrade>,
    #[serde(rename = "nextBefore")]
    pub next_before: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FundingHistoryPoint {
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
    #[serde(rename = "rateBps")]
    pub rate_bps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FundingResponse {
    #[serde(rename = "marketId")]
    pub market_id: String,
    #[serde(rename = "currentRateBps")]
    pub current_rate_bps: f64,
    #[serde(rename = "nextSettlementTsNs")]
    pub next_settlement_ts_ns: String,
    pub history: Vec<FundingHistoryPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaceOrderRequest {
    #[serde(rename = "marketId")]
    pub market_id: String,
    /// "buy" or "sell".
    pub side: String,
    /// "market" or "limit".
    #[serde(rename = "type")]
    pub order_type: String,
    pub price: Option<String>,
    pub qty: String,
    #[serde(rename = "timeInForce")]
    pub time_in_force: String,
    #[serde(rename = "reduceOnly", default)]
    pub reduce_only: bool,
    #[serde(rename = "postOnly", default)]
    pub post_only: bool,
    #[serde(rename = "clientOrderId")]
    pub client_order_id: Option<String>,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaceOrderResponse {
    #[serde(rename = "orderId")]
    pub order_id: String,
    pub status: String,
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CancelOrderResponse {
    #[serde(rename = "orderId")]
    pub order_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OpenOrder {
    pub id: String,
    #[serde(rename = "marketId")]
    pub market_id: String,
    pub side: String,
    #[serde(rename = "type")]
    pub order_type: String,
    pub price: String,
    pub qty: String,
    pub remaining: String,
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
    #[serde(rename = "clientOrderId")]
    pub client_order_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OpenOrdersResponse {
    pub orders: Vec<OpenOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PositionInfo {
    #[serde(rename = "marketId")]
    pub market_id: String,
    pub size: String,
    /// "long" or "short".
    pub side: String,
    #[serde(rename = "entryPriceX18")]
    pub entry_price_x18: String,
    #[serde(rename = "markPriceX18")]
    pub mark_price_x18: String,
    #[serde(rename = "notionalUsdc")]
    pub notional_usdc: String,
    #[serde(rename = "unrealisedPnlUsdc")]
    pub unrealised_pnl_usdc: String,
    #[serde(rename = "realisedPnlUsdc")]
    pub realised_pnl_usdc: String,
    pub leverage: String,
    #[serde(rename = "liquidationPriceX18")]
    pub liquidation_price_x18: String,
    #[serde(rename = "fundingPaidUsdc")]
    pub funding_paid_usdc: String,
    #[serde(rename = "lastUpdatedTsNs")]
    pub last_updated_ts_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PositionsResponse {
    #[serde(rename = "collateralUsdc")]
    pub collateral_usdc: String,
    #[serde(rename = "freeCollateralUsdc")]
    pub free_collateral_usdc: String,
    #[serde(rename = "totalUnrealisedPnlUsdc")]
    pub total_unrealised_pnl_usdc: String,
    #[serde(rename = "totalNotionalUsdc")]
    pub total_notional_usdc: String,
    pub positions: Vec<PositionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FillInfo {
    pub id: String,
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "marketId")]
    pub market_id: String,
    pub side: String,
    pub price: String,
    pub qty: String,
    #[serde(rename = "feeUsdc")]
    pub fee_usdc: String,
    /// "taker" or "maker".
    pub role: String,
    #[serde(rename = "tsNs")]
    pub ts_ns: String,
    #[serde(rename = "txHash")]
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FillsResponse {
    pub fills: Vec<FillInfo>,
    #[serde(rename = "nextBefore")]
    pub next_before: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SiweNonceRequest {
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SiweNonceResponse {
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SiweVerifyRequest {
    pub message: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SiweVerifyResponse {
    pub jwt: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BalanceResponse {
    #[serde(rename = "vaultBalanceUsdc")]
    pub vault_balance_usdc: String,
    #[serde(rename = "walletUsdcBalance")]
    pub wallet_usdc_balance: String,
    #[serde(rename = "pendingDeposits")]
    pub pending_deposits: Vec<serde_json::Value>,
    #[serde(rename = "pendingWithdrawals")]
    pub pending_withdrawals: Vec<serde_json::Value>,
}
