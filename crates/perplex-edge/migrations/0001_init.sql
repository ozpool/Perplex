-- Perplex edge durable state. Mirrors the in-memory AppState stores 1:1 so a
-- restart rehydrates orders, positions, fills, balances, the public tape, and
-- funding history. Numeric values are stored as the exact decimal strings the
-- API serves (never floats) so the round-trip is lossless. Ephemeral/derived
-- state (orderbook snapshots, live oracle prices, SIWE nonces) is intentionally
-- NOT persisted: the book is rebuilt from open_orders on boot, prices come from
-- the live oracle, and nonces expire in seconds.

CREATE TABLE IF NOT EXISTS open_orders (
    id              TEXT PRIMARY KEY,
    address         TEXT NOT NULL,
    market_id       TEXT NOT NULL,
    side            TEXT NOT NULL,
    order_type      TEXT NOT NULL,
    price           TEXT NOT NULL,
    qty             TEXT NOT NULL,
    remaining       TEXT NOT NULL,
    ts_ns           TEXT NOT NULL,
    client_order_id TEXT
);
CREATE INDEX IF NOT EXISTS open_orders_address_idx ON open_orders (address);

CREATE TABLE IF NOT EXISTS positions (
    address               TEXT NOT NULL,
    market_id             TEXT NOT NULL,
    size                  TEXT NOT NULL,
    side                  TEXT NOT NULL,
    entry_price_x18       TEXT NOT NULL,
    mark_price_x18        TEXT NOT NULL,
    notional_usdc         TEXT NOT NULL,
    unrealised_pnl_usdc   TEXT NOT NULL,
    realised_pnl_usdc     TEXT NOT NULL,
    leverage              TEXT NOT NULL,
    liquidation_price_x18 TEXT NOT NULL,
    funding_paid_usdc     TEXT NOT NULL,
    last_updated_ts_ns    TEXT NOT NULL,
    PRIMARY KEY (address, market_id)
);

-- seq preserves insertion order across rehydrate; ts_ns alone can collide.
CREATE TABLE IF NOT EXISTS fills (
    id        TEXT PRIMARY KEY,
    address   TEXT NOT NULL,
    order_id  TEXT NOT NULL,
    market_id TEXT NOT NULL,
    side      TEXT NOT NULL,
    price     TEXT NOT NULL,
    qty       TEXT NOT NULL,
    fee_usdc  TEXT NOT NULL,
    role      TEXT NOT NULL,
    ts_ns     TEXT NOT NULL,
    tx_hash   TEXT NOT NULL,
    seq       BIGSERIAL
);
CREATE INDEX IF NOT EXISTS fills_address_seq_idx ON fills (address, seq);

CREATE TABLE IF NOT EXISTS vault_balances (
    address TEXT PRIMARY KEY,
    amount  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_trades (
    id        TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    price     TEXT NOT NULL,
    qty       TEXT NOT NULL,
    side      TEXT NOT NULL,
    ts_ns     TEXT NOT NULL,
    seq       BIGSERIAL
);
CREATE INDEX IF NOT EXISTS public_trades_market_seq_idx ON public_trades (market_id, seq);

CREATE TABLE IF NOT EXISTS funding_history (
    market_id TEXT NOT NULL,
    ts_ns     BIGINT NOT NULL,
    rate_bps  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (market_id, ts_ns)
);
