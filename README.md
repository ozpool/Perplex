# Perplex

dYdX-class decentralised perpetual futures exchange. Orderbook-matched, USDC-collateralised, self-custodial.

- Off-chain matching engine in Rust for centralised-exchange latency
- On-chain settlement in Solidity on Arbitrum (BUSL-1.1)
- Pyth pull oracle on testnet/mainnet, Chainlink sanity bound, MockOracle locally
- v1 markets: BTC-USD, ETH-USD, SOL-USD
- 20x max leverage, 8h funding cadence, EIP-712 signed batch settlement

Current status: **v0.1.0-phase4** — Oracle / Funding / Liquidation / ADL shipped. Phase 5 (API + WebSocket + SDK) in progress.

---

## Architecture

```
                       +--------------------+
   Wallets / FE  --->  |  perplex-edge      |  REST + WebSocket
                       |  (axum, JWT, SIWE) |
                       +---------+----------+
                                 |
                                 v
                       +--------------------+
                       |  perplex-matching  |  Per-market Tokio workers
                       |  (BTreeMap book,   |  ~9.8M ops/sec on M-class
                       |   Redis Streams)   |
                       +---------+----------+
                                 |
                EIP-712 signed batch (Fill[], nonce, deadline)
                                 |
                                 v
+-----------------+    +---------------------+    +------------------+
|  OracleAdapter  |--->|  SettlementEngine   |--->|  PositionRegistry|
|  (Pyth +        |    |  (atomic-on-fail)   |    |  (VWAP / funding |
|   Chainlink)    |    +-----+---------------+    |   / health)      |
+-----------------+          |                    +---------+--------+
                             v                              |
                       +-----------+     +----------------+ |
                       |  Collat.  |<--->| FundingEngine  | |
                       |  Vault    |     | (8h cadence)   | |
                       +-----+-----+     +----------------+ |
                             |                              |
                             v                              v
            +------------------+        +-----------------------+
            | LiquidationEngine|------->|     InsuranceFund     |
            | (liquidate + adl)|        |  (residual + ADL pot) |
            +------------------+        +-----------------------+
```

---

## Quickstart

Prereqs: Docker, Foundry (`foundryup`), Rust 1.82+, Node 20+, pnpm 9.

```bash
git clone https://github.com/ozpool/Perplex.git
cd Perplex
cp .env.example .env
make dev-up        # anvil + postgres + redis + mock oracle, deploys all contracts
make dev-trade     # seeds 5 wallets with 100k mock USDC each, runs a smoke trade
```

`make dev-up` brings up the full local stack, deploys contracts, and exposes the edge API at `http://localhost:8080` (REST) and `ws://localhost:8081` (WebSocket once Phase 5 ships).

`make dev-down` stops the stack. `make dev-reset` wipes volumes and re-bootstraps.

Run the API server directly:

```bash
cargo run -p perplex-edge -- --bind 127.0.0.1:8080
open http://127.0.0.1:8080/docs        # Swagger UI
```

---

## Layout

```
contracts/        Solidity sources + Foundry tests (unit, invariant, differential)
  src/            CollateralVault, PositionRegistry, MarketRegistry, SettlementEngine,
                  OracleAdapter, FundingEngine, LiquidationEngine, InsuranceFund
  lib/            forge-std, openzeppelin-contracts, solady, pyth-sdk-solidity
crates/           Rust workspace
  perplex-core        Margin math mirroring on-chain formulas
  perplex-matching    BTreeMap orderbook + per-market workers + Redis Streams writer
  perplex-oracle      Pyth Hermes REST source + drift-triggered relayer
  perplex-funding     Redis SETNX leader-election cron
  perplex-edge        Axum REST API (11 endpoints, utoipa OpenAPI)
  perplex-diff-gen    Generates Rust JSON fixtures replayed in Solidity diff tests
docs/             openapi.json + postman.json (auto-exported)
scripts/          Local seed + EIP-712 batch signers
infra/            docker-compose.yml, Terraform (separate ops doc)
.github/          CI workflows (Foundry + Cargo + devnet smoke)
Makefile          Top-level commands
```

---

## Component status

| Component | Phase | Status |
|---|---|---|
| CollateralVault | 1 | shipped |
| MarketRegistry | 1 | shipped |
| PositionRegistry (VWAP + health + funding) | 2 | shipped |
| SettlementEngine (EIP-712 batched) | 2 | shipped |
| Orderbook + per-market workers | 3 | shipped |
| Differential + invariant tests | 3 | shipped |
| OracleAdapter (Pyth + Chainlink sanity) | 4 | shipped |
| FundingEngine + Rust SETNX cron | 4 | shipped |
| LiquidationEngine + InsuranceFund | 4 | shipped |
| ADL socialisation | 4 | shipped |
| REST API (11 endpoints + OpenAPI) | 5 | shipped |
| WebSocket (5 channels, backpressure) | 5 | pending |
| SessionKey contract | 5 | pending |
| Redis token-bucket rate limiting | 5 | pending |
| TypeScript SDK + load test | 5 | pending |
| Frontend (Next.js trading UI) | 6 | pending |
| SyntheticCounterparty bootstrap | 7 | pending |
| Audit + rollout | 8 | pending |

---

## Tests

```bash
forge test                   # 164 unit + invariant + differential
cargo test --workspace       # Rust crates
cargo clippy --workspace --all-targets -- -D warnings
forge fmt --check && cargo fmt --all -- --check
```

Differential tests replay 500 Rust-generated scenarios on-chain with a 256 wei tolerance for Decimal-vs-integer rounding. Invariants run 256 fuzz rounds x 16384 calls each and assert: per-market sum of position sizes = 0, cumulative funding cashflow nets to dust, insurance fund balance is monotonic.

---

## API

REST contract is the source of truth for the frontend — sections 1.1-1.11 of `api-contract.md`. Live OpenAPI is auto-derived via utoipa and served at `/docs`. A Postman collection is exported to `docs/postman.json`.

WebSocket channels (Phase 5):

| Channel | Auth | Payload |
|---|---|---|
| `orderbook.{marketId}` | public | snapshot + deltas with sequence |
| `trades.{marketId}` | public | public fills |
| `oracle.{marketId}` | public | mark price ticks |
| `user.fills` | bearer | private fills |
| `user.positions` | bearer | private position diffs |

---

## Branch and PR rules

- All changes land via PR; maintainer merges, contributors do not push to `main`
- Branch naming: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`
- CI (Foundry + Cargo + devnet smoke) must be green before review
- Branches are preserved on merge — never `--delete-branch`
- Commits use a verb-first imperative subject

---

## License

BUSL-1.1 (source-available). Converts to MIT once Stage-3 mainnet is stable.
