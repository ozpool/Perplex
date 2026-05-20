use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SubmitError {
    #[error("post-only order would cross the book")]
    PostOnlyWouldCross,
    #[error("fill-or-kill could not fill the full quantity")]
    FokUnfillable,
    #[error("reduce-only order would increase net position")]
    ReduceOnlyWouldIncrease,
    #[error("self-trade prevention rejected the taker side")]
    SelfTradeRejected,
    #[error("order quantity must be > 0")]
    ZeroQty,
    #[error("limit order price must be > 0")]
    ZeroPrice,
    #[error("market order without sufficient counter-side liquidity")]
    MarketNoLiquidity,
}
