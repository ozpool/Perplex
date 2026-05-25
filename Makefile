.PHONY: help install dev-up dev-down dev-reset dev-deposit dev-trade dev-liquidate sim-replay smoke-grafana metrics-up metrics-down dev-logs deploy-sepolia-dry deploy-sepolia build test test-contracts test-rust lint fmt clean
# Default anvil deployer key. Override per-env when deploying to Sepolia / mainnet.
DEPLOYER_PRIVATE_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

install: ## Install Node deps for the smoke scripts
	pnpm install --frozen-lockfile

dev-up: install ## Start local stack and deploy contracts; seed wallets
	docker compose up -d
	./scripts/wait-for-anvil.sh
	./scripts/wait-for-postgres.sh
	cd contracts && DEPLOYER_PRIVATE_KEY=$(DEPLOYER_PRIVATE_KEY) forge script script/Deploy.s.sol \
	  --rpc-url http://localhost:8545 --broadcast --silent
	pnpm tsx scripts/seed.ts
	@echo ""
	@echo "Local Perplex devnet ready."
	@echo "  Anvil   http://localhost:8545"
	@echo "  Pg      postgres://perplex:perplex@localhost:5432/perplex"
	@echo "  Redis   redis://localhost:6379"
	@echo ""

dev-down: ## Stop containers (keep volumes)
	docker compose down

dev-reset: ## Wipe volumes and re-bootstrap
	docker compose down -v
	rm -rf deployments
	$(MAKE) dev-up

dev-deposit: ## Smoke deposit / withdraw / blocked-withdraw against local stack
	pnpm tsx scripts/smoke-deposit.ts

dev-trade: ## Place a smoke trade (Phase 3+)
	pnpm tsx scripts/smoke-trade.ts

dev-liquidate: ## Force-crash price and verify liquidation pipeline (Phase 4+)
	pnpm tsx scripts/smoke-liquidate.ts

sim-replay: ## 30-day synthetic CEX-tape replay against the counterparty agent
	pnpm tsx scripts/replay-binance.ts

smoke-grafana: ## Validate infra/grafana/counterparty.json wire-up against agent metrics
	pnpm tsx scripts/smoke-grafana.ts

metrics-up: ## Launch local Prometheus + Grafana scraping the counterparty agent
	docker compose -f infra/docker-compose.metrics.yml up -d

metrics-down: ## Stop Prometheus + Grafana stack
	docker compose -f infra/docker-compose.metrics.yml down

deploy-sepolia-dry: ## Simulate Sepolia deploy (no broadcast)
	./scripts/deploy-sepolia.sh

deploy-sepolia: ## BROADCAST to Arbitrum Sepolia (requires Sepolia ETH + env vars)
	./scripts/deploy-sepolia.sh --broadcast

dev-logs: ## Tail logs from all services
	docker compose logs -f

build: ## Build everything (contracts + rust)
	cd contracts && forge build
	cargo build --workspace

test: test-contracts test-rust ## Run full test suite

test-contracts: ## Foundry unit + invariant tests
	cd contracts && forge test -vvv

test-rust: ## Rust unit + property tests
	cargo test --workspace --all-features

lint: ## Lint rust + solidity
	cargo clippy --workspace --all-targets --all-features -- -D warnings
	cd contracts && forge fmt --check

fmt: ## Format rust + solidity
	cargo fmt --all
	cd contracts && forge fmt

diff-fixtures: ## Regenerate the differential test fixtures (Rust → JSON)
	cargo run -p perplex-diff-gen --release --bin gen-vwap-fixtures \
	    > contracts/test/differential/fixtures.json
	@echo "fixtures regenerated; commit contracts/test/differential/fixtures.json"

bench: ## Run criterion microbenchmarks for perplex-matching
	cargo bench -p perplex-matching

clean: ## Clean build artefacts
	cargo clean
	cd contracts && forge clean
