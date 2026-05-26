<div align="center">

<img src="web/public/perplex-mark.png" alt="Perplex" width="160" />

# Perplex

**A dYdX-class decentralised perpetual-futures exchange.**
Orderbook-matched. USDC-collateralised. Self-custodial. Built for Arbitrum.

[![License](https://img.shields.io/badge/license-BUSL--1.1-orange?style=flat-square)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square&logo=solidity)](contracts/)
[![Rust](https://img.shields.io/badge/Rust-2021-CE412B?style=flat-square&logo=rust)](crates/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs)](web/)
[![Foundry](https://img.shields.io/badge/Foundry-tested-FFBF00?style=flat-square)](contracts/)
[![Status](https://img.shields.io/badge/status-v1%20local--first-blueviolet?style=flat-square)](#status)

</div>

---

## What it is

Perplex is a **hybrid perpetual-futures DEX**: an off-chain orderbook matched in Rust for centralised-exchange latency, with every fill settled atomically on-chain in Solidity. Traders keep custody of their USDC; the matching engine never holds funds. The match layer is replaceable — settlement does not trust it.

Three markets ship in v1: `BTC-USD`, `ETH-USD`, `SOL-USD`. Up to 20× leverage, 1h funding cadence, EIP-712 signed batch settlement, Pyth pull-oracle on testnet/mainnet with Chainlink as a sanity bound. A local `MockOracle` and `MockUSDC` make the whole stack runnable on a laptop with `make dev-up`.

---

## Capabilities

- **Self-custodial trading.** USDC stays in `CollateralVault` until the trader signs an EIP-712 fill that the on-chain settlement engine re-verifies. The matching server cannot move funds.
- **CEX-grade latency.** Rust + axum + `tokio` matching engine with a per-market `BTreeMap` orderbook. Benchmarks land in the low millions of ops/sec on a single core.
- **Atomic settlement.** `SettlementEngine` either applies every fill in a batch or reverts the whole batch. No partial fills, no torn state.
- **Lazy hourly funding.** Cumulative funding index per market. Positions settle their funding obligation on next interaction — O(1) per position, O(1) per window.
- **Liquidation + insurance + ADL.** Underwater positions close at the oracle mark; penalty flows to `InsuranceFund`; auto-deleveraging is the last-resort backstop when the fund is empty.
- **Real-time UI.** Next.js 16 + React 19 + Wagmi v3 frontend with SIWE login, EIP-712 order signing, live orderbook + fills + mark via WebSocket.
- **Local-first dev loop.** `make dev-up` boots Anvil + Postgres + Redis, deploys 11 contracts, seeds prices, mints `MockUSDC` — full stack in under a minute.
- **Observability.** Per-binary Prometheus `/metrics`, auto-provisioned Grafana counterparty dashboard via `make metrics-up`.

---

## Tech stack

| Layer | Stack |
|---|---|
| Smart contracts | Solidity `0.8.24` · Foundry · OpenZeppelin · Solady · `pyth-sdk-solidity` |
| Matching + edge | Rust 2021 · `axum` · `tokio` · `tokio-tungstenite` · `sqlx` · `redis-rs` · `jsonwebtoken` · `k256` |
| Frontend | Next.js 16 (App Router) · React 19 · Wagmi v3 · `viem` · TanStack Query · Zustand · Tailwind v4 · MSW |
| Infra | Docker Compose · Anvil · Postgres 16 · Redis 7 · Prometheus · Grafana |
| Auth | SIWE (EIP-4361) · JWT (HS256) · EIP-712 typed-data order signing |
| Oracles | Pyth Hermes pull-feed (testnet/mainnet) · Chainlink sanity bound · `MockOracle` (local) |
| Target chain | Arbitrum One (mainnet) · Arbitrum Sepolia (testnet) · Anvil `chainId 31337` (local) |

---

## Architecture

The off-chain layer reads intent, matches, and forwards signed fills. The on-chain layer re-verifies signatures and is the **only** writer of money state.

```mermaid
flowchart LR
    subgraph Client["Client"]
        FE["Next.js dApp<br/>Wagmi · viem"]
        MM["MetaMask<br/>SIWE + EIP-712"]
    end

    subgraph OffChain["Off-chain (Rust)"]
        EDGE["perplex-edge<br/>axum · JWT · WS"]
        MATCH["perplex-matching<br/>per-market book"]
        BOT["perplex-cli quote<br/>counterparty bot"]
        ORACLE["perplex-oracle<br/>price relayer"]
        FUND["perplex-funding<br/>leader-elected cron"]
        RISK["perplex-cli risk<br/>liquidation scanner"]
    end

    subgraph Storage["Storage"]
        PG[("Postgres<br/>history")]
        REDIS[("Redis<br/>book snap · leases")]
    end

    subgraph OnChain["On-chain (Solidity / Arbitrum)"]
        VAULT["CollateralVault"]
        SETTLE["SettlementEngine<br/>EIP-712 verify"]
        POS["PositionRegistry"]
        MR["MarketRegistry"]
        FE_C["FundingEngine"]
        OA["OracleAdapter<br/>Pyth + Chainlink"]
        LIQ["LiquidationEngine"]
        INS["InsuranceFund"]
        SYN["SyntheticCounterparty<br/>2-day timelock"]
    end

    FE --> MM
    FE -- "REST / WS" --> EDGE
    MM -- "SIWE / EIP-712" --> EDGE
    EDGE --> MATCH
    BOT --> EDGE
    MATCH --> PG
    MATCH --> REDIS
    EDGE --> PG
    EDGE --> REDIS

    MATCH -- "signed fills" --> SETTLE
    SETTLE --> VAULT
    SETTLE --> POS
    SETTLE --> MR

    ORACLE --> OA
    OA --> FE_C
    FUND --> FE_C
    FE_C --> POS

    RISK --> POS
    RISK --> LIQ
    LIQ --> POS
    LIQ --> VAULT
    LIQ --> INS
    INS --> SYN

    classDef chain fill:#fef2f2,stroke:#d63044,color:#7f1d1d
    classDef rust  fill:#fffbeb,stroke:#d97706,color:#78350f
    classDef store fill:#f4f3f8,stroke:#736b8a,color:#3d3656
    classDef user  fill:#faf5ff,stroke:#7c3aed,color:#4c1d95
    class VAULT,SETTLE,POS,MR,FE_C,OA,LIQ,INS,SYN chain
    class EDGE,MATCH,BOT,ORACLE,FUND,RISK rust
    class PG,REDIS store
    class FE,MM user
```

### Trade lifecycle — one fill, end to end

```mermaid
sequenceDiagram
    autonumber
    participant U as Trader
    participant W as MetaMask
    participant E as perplex-edge
    participant M as Matching
    participant B as Counterparty bot
    participant S as SettlementEngine
    participant V as CollateralVault
    participant P as PositionRegistry

    U->>W: Connect + sign SIWE
    W->>E: POST /v1/auth/siwe/verify
    E-->>U: JWT (HS256)

    B->>E: POST /v1/orders (resting bid + ask, signed)
    E->>M: insert into book

    U->>W: Build order · sign EIP-712
    W-->>U: signature (132 hex)
    U->>E: POST /v1/orders (taker, signed)
    E->>M: match against resting side
    M-->>E: Fill[]

    E->>S: settle(Fill[]) tx
    S->>S: verify maker + taker EIP-712
    S->>V: pull initial margin
    S->>P: open / update positions
    S-->>E: tx hash

    E-->>U: WS frame: fill + position update
```

### Settlement guarantee

```mermaid
flowchart TD
    Q["Edge submits Fill[]<br/>to SettlementEngine"]
    V1{"verify maker sig<br/>(EIP-712)"}
    V2{"verify taker sig<br/>(EIP-712)"}
    V3{"IMR · max lev · market open<br/>(MarketRegistry)"}
    OK["pull margin · open positions<br/>emit Trade event"]
    REV["revert whole batch<br/>nothing moves"]

    Q --> V1
    V1 -- ok --> V2
    V2 -- ok --> V3
    V3 -- ok --> OK
    V1 -- fail --> REV
    V2 -- fail --> REV
    V3 -- fail --> REV

    classDef ok fill:#f0fdf4,stroke:#0fa56a,color:#14532d
    classDef bad fill:#fef2f2,stroke:#d63044,color:#7f1d1d
    classDef neu fill:#fafafa,stroke:#a1a1aa,color:#3d3656
    class OK ok
    class REV bad
    class Q,V1,V2,V3 neu
```

---

## Quickstart

Prereqs — Docker Desktop, Foundry (`foundryup`), Rust 1.82+, Node 20+, pnpm 9.

```bash
git clone https://github.com/ozpool/Perplex.git perplex
cd perplex
cp .env.example .env
pnpm install --frozen-lockfile
make dev-up
```

`make dev-up` boots Anvil + Postgres + Redis, deploys all 11 contracts, seeds market prices (`BTC=$100k · ETH=$3.5k · SOL=$200`), and mints `MockUSDC` to the test accounts.

In a second terminal start the edge:

```bash
export PERPLEX_JWT_SECRET=$(openssl rand -hex 32)
export DATABASE_URL=postgres://perplex:perplex@localhost:5432/perplex
export REDIS_URL=redis://localhost:6379
export RPC_URL=http://localhost:8545
export RUST_LOG=info

cargo run --bin perplex-edge
# REST  http://localhost:8080
# Docs  http://localhost:8080/docs
```

In a third terminal start the counterparty bot so the orderbook isn't empty:

```bash
OP_ADDR=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
TOKEN=$(curl -s http://localhost:8080/__dev/token/$OP_ADDR | sed 's/^Bearer //')
SIG=0x$(printf '0%.0s' {1..130})

cargo run -p perplex-cli -- quote \
  --edge-url http://localhost:8080 \
  --markets btc-usd,eth-usd,sol-usd \
  --order-signature $SIG \
  --token $TOKEN
```

Then the web UI:

```bash
cd web && pnpm dev:real
# open http://localhost:3000
```

Stop the stack with `make dev-down`. Wipe + re-bootstrap with `make dev-reset`. A full step-by-step demo runbook (MetaMask setup, dev wallet import, every terminal) lives in the [Notion playbook](https://www.notion.so/36c9a63078bd81529f74df2de761fdb5).

---

## Repo layout

```
contracts/             Solidity sources + Foundry tests (unit, invariant, differential)
  src/                 11 contracts (Vault, Registry, Settlement, Funding, Liquidation, Oracle, …)
  lib/                 forge-std, openzeppelin-contracts, solady, pyth-sdk-solidity
  script/              Deploy.s.sol (Anvil + Sepolia)
crates/                Rust workspace
  perplex-core         Shared types + EIP-712 domain + margin math
  perplex-matching     BTreeMap orderbook · per-market workers · fill streams
  perplex-edge         axum REST + WS · JWT · SIWE · OpenAPI (utoipa)
  perplex-oracle       Pyth Hermes source + drift-triggered relayer
  perplex-funding      Redis SETNX leader-election cron
  perplex-mock-oracle  Local replay oracle pusher
  perplex-cli          One bin, many subcommands: edge / quote / oracle / risk / kill / metrics
  perplex-diff-gen     Rust JSON fixtures replayed in Solidity diff tests
web/                   Next.js 16 frontend
  app/(app)/           trade · markets · portfolio · wallet · history
  app/(marketing)/     Public landing
  lib/                 wallet (Wagmi · SIWE) · contracts · ws · api
  styles/              tokens.css (dark + orange theme)
docs/                  openapi.json · postman.json · margin-math.md
infra/                 docker-compose.metrics.yml · Grafana dashboard JSON
scripts/               seed · smoke-deposit · smoke-trade · smoke-liquidate · replay-binance
sdk/                   TypeScript SDK (Phase 5)
Makefile               Top-level commands
```

---

## Component status

| Component | Phase | Status |
|---|---|---|
| `CollateralVault` | 1 | shipped |
| `MarketRegistry` | 1 | shipped |
| `PositionRegistry` (VWAP + health + funding stamp) | 2 | shipped |
| `SettlementEngine` (EIP-712 batched) | 2 | shipped |
| Orderbook + per-market workers | 3 | shipped |
| Differential + invariant tests | 3 | shipped |
| `OracleAdapter` (Pyth + Chainlink sanity) | 4 | shipped |
| `FundingEngine` + Rust SETNX cron | 4 | shipped |
| `LiquidationEngine` + `InsuranceFund` | 4 | shipped |
| ADL socialisation | 4 | shipped |
| REST API (11 endpoints + OpenAPI) | 5 | shipped |
| WebSocket (5 channels, backpressure) | 5 | shipped |
| Counterparty bot (quote agent + kill switch) | 5 | shipped |
| SessionKey contract | 5 | shipped |
| Frontend (Next.js trading UI) | 6 | shipped |
| Redis token-bucket rate limiting | 6 | shipped |
| TypeScript SDK + load test | 7 | pending |
| MegaVault LP backstop | 7 | pending |
| Arbitrum Sepolia bringup | 8 | pending |
| External audit + mainnet rollout | 9 | pending |

---

## Testing

```bash
forge test                        # 164 unit + invariant + differential
cargo test --workspace            # Rust crates
cargo clippy --workspace --all-targets -- -D warnings
forge fmt --check && cargo fmt --all -- --check
```

Differential tests replay 500 Rust-generated scenarios on-chain with a 256-wei tolerance for `Decimal`-vs-integer rounding. Invariants run 256 fuzz rounds × 16384 calls each and assert:

- per-market sum of position sizes = 0
- cumulative funding cashflow nets to dust
- insurance fund balance is monotonic in the absence of bad debt

End-to-end smokes:

```bash
make dev-deposit      # deposit / withdraw / blocked-withdraw path
make dev-trade        # place + match + settle
make dev-liquidate    # crash price · verify liquidation cascade
make sim-replay       # 30-day Binance tape against the counterparty agent
```

---

## API

REST surface is the source of truth for the frontend — every endpoint is documented in `docs/openapi.json`, auto-derived via `utoipa`, and served at `http://localhost:8080/docs`. A Postman collection is exported to `docs/postman.json`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/auth/siwe/nonce` | public | start SIWE login |
| `POST` | `/v1/auth/siwe/verify` | public | finish SIWE, mint JWT |
| `GET`  | `/v1/markets` | public | list markets |
| `GET`  | `/v1/orderbook/:market_id` | public | orderbook snapshot |
| `GET`  | `/v1/trades/:market_id` | public | recent fills |
| `GET`  | `/v1/funding/:market_id` | public | funding rate history |
| `POST` | `/v1/orders` | bearer | place signed order |
| `DELETE` | `/v1/orders/:order_id` | bearer | cancel |
| `GET`  | `/v1/orders/open` | bearer | open orders |
| `GET`  | `/v1/positions` | bearer | open positions |
| `GET`  | `/v1/fills` | bearer | private fills |
| `GET`  | `/v1/account/balance` | bearer | vault balance |

### WebSocket channels

| Channel | Auth | Payload |
|---|---|---|
| `orderbook.{marketId}` | public | snapshot + deltas with sequence |
| `trades.{marketId}` | public | public fills |
| `oracle.{marketId}` | public | mark price ticks |
| `user.fills` | bearer | private fills |
| `user.positions` | bearer | private position diffs |

---

## Roadmap

- **v1.0 (current)** — local-first hybrid DEX. 3 markets. Full settle / fund / liquidate / ADL cascade. Self-host with one Make target.
- **v1.1** — Arbitrum Sepolia bringup. Pyth Hermes wired live. MegaVault LP backstop. Auto-liquidation watcher. SessionKey UX so MetaMask doesn't prompt per order.
- **v2.0** — Arbitrum One mainnet. External audit. More markets. Cross-margin. SDK on npm.

---

## Contributing

- Every change lands via PR. Contributors do not push to `main`.
- Branch naming: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`.
- CI (Foundry + Cargo + devnet smoke) must be green before review.
- Branches are preserved on merge — never `--delete-branch`.
- Commits use a verb-first imperative subject.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full development loop.

---

## License

[BUSL-1.1](LICENSE) (source-available). Converts to MIT once Stage-3 mainnet is stable.
