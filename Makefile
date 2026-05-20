.PHONY: help dev-up dev-down dev-reset dev-trade dev-liquidate dev-logs build test test-contracts test-rust lint fmt clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

dev-up: ## Start local stack (anvil + db + redis + mock-pyth) and seed
	docker compose up -d
	./scripts/wait-for-anvil.sh
	./scripts/wait-for-postgres.sh
	cd contracts && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --silent
	pnpm tsx scripts/seed.ts
	@echo ""
	@echo "Local Perplex devnet ready."
	@echo "  Anvil   http://localhost:8545"
	@echo "  Pg      postgres://perplex:perplex@localhost:5432/perplex"
	@echo "  Redis   redis://localhost:6379"
	@echo "  Pyth    http://localhost:8546"
	@echo ""

dev-down: ## Stop containers (keep volumes)
	docker compose down

dev-reset: ## Wipe volumes and re-bootstrap
	docker compose down -v
	$(MAKE) dev-up

dev-trade: ## Place a smoke trade against local stack
	pnpm tsx scripts/smoke-trade.ts

dev-liquidate: ## Force-crash price and verify liquidation pipeline
	pnpm tsx scripts/smoke-liquidate.ts

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

clean: ## Clean build artefacts
	cargo clean
	cd contracts && forge clean
