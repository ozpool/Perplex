# Perplex

Decentralised perpetual futures exchange. Orderbook-matched, USDC-collateralised, self-custodial.

- Off-chain matching engine in Rust for centralised-exchange latency
- On-chain settlement in Solidity on Arbitrum
- Pyth pull oracle on testnet/mainnet, MockOracle locally
- v1 markets: BTC-USD, ETH-USD, SOL-USD

## Quickstart

Prereqs: Docker, Foundry (`foundryup`), Rust (1.82+), Node 20+, pnpm 9.

```bash
git clone https://github.com/ozpool/Perplex.git
cd Perplex
cp .env.example .env
make dev-up
make dev-trade
```

`make dev-up` brings up anvil, postgres, redis, and the mock oracle, deploys all contracts to the local chain, and seeds 5 test wallets with 100,000 mock USDC each. The exchange runs on `http://localhost:8080` (REST) and `ws://localhost:8081` (WebSocket) once Phase 5 services are wired.

`make dev-down` stops the stack. `make dev-reset` wipes volumes and re-bootstraps.

## Layout

```
contracts/        Solidity, Foundry workspace
crates/           Rust workspace
scripts/          Local seed and smoke tests
infra/            Docker Compose, Terraform (separate ops doc)
.github/          CI workflows
docker-compose.yml  Phase 0 local stack
Makefile          Top-level commands
```

## Branch and PR rules

- All changes land via PR.
- Branch naming: `phase-N/<feature>`, e.g. `phase-1/collateral-vault`.
- CI must be green before review.
- Maintainer merges; contributors do not push to `main`.

## License

BUSL-1.1 (source-available). Converts to MIT once Stage-3 mainnet is stable.
