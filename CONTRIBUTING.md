# Contributing to Perplex

Thanks for your interest in Perplex. This guide covers the development loop, the standards every change is held to, and how to get a pull request merged.

## Ground rules

- Every change lands via pull request. Nobody pushes to `main` directly.
- All CI checks must be green before a PR is reviewed.
- Branches are preserved on merge — do not use `--delete-branch`.
- Keep PRs focused: one logical change per PR. Large, unrelated diffs are hard to review and slow to merge.

## Prerequisites

- **Rust** (stable, 2021 edition — see `rust-toolchain` / `Cargo.toml` for the pinned version)
- **Foundry** (`forge`, `cast`, `anvil`)
- **Node.js 22+** and **pnpm** (for the web app and SDK)
- **Docker** + **Docker Compose** (local Anvil, Postgres, Redis)

## Local setup

Bring up the full local stack — Anvil, Postgres, Redis, deployed contracts, seeded markets and balances:

```bash
make dev-up
```

For the one-command path that also launches the edge, counterparty bot, and frontend in separate terminals:

```bash
./scripts/dev-up-all.sh
```

Tear down when finished:

```bash
make dev-down      # stop containers, keep volumes
make dev-reset     # wipe volumes and re-bootstrap
```

## Branching

Branch off `main` using a type prefix:

- `feat/<name>` — a new capability
- `fix/<name>` — a bug fix
- `docs/<name>` — documentation only
- `chore/<name>` — tooling, deps, housekeeping

## Commits

- Verb-first, imperative subject line (e.g. `feat(edge): enforce margin gate on order entry`).
- Keep the subject under ~70 characters; put the *why* in the body when it isn't obvious.
- Group related work into coherent commits rather than one catch-all commit.

## Before you open a PR

Run the same checks CI runs, locally, and make sure they pass:

```bash
# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace

# Solidity
cd contracts && forge fmt --check && forge test -vvv

# Web (from web/)
pnpm install --frozen-lockfile
pnpm web:typecheck && pnpm web:lint && pnpm web:build
```

End-to-end smoke checks against the local stack:

```bash
make dev-deposit    # deposit / withdraw / blocked-withdraw path
make dev-trade      # place + match + settle
make dev-liquidate  # crash price, verify the liquidation cascade
make sim-replay     # replay a market tape against the counterparty bot
```

## Pull requests

- Target `main`.
- Write a clear description: what changed, why, and how it was tested.
- Link any related issue (`Closes #123`).
- Ensure CI is green. A red PR will not be reviewed until it is fixed.
- Address review feedback by pushing follow-up commits to the same branch.

A maintainer merges once the PR is approved and CI is green. Branches are kept after merge.

## Code standards

- **Rust** — idiomatic, `clippy`-clean with warnings denied, `rustfmt`-formatted. Prefer clear names and small functions; match the style of the surrounding module.
- **Solidity** — `forge fmt`-formatted; every money-touching change needs a test, and where applicable a differential or invariant test.
- **Tests** — new behaviour ships with tests. Don't reduce coverage of the matching, margin, settlement, or liquidation paths.
- **Numbers** — money and prices cross the wire as decimal strings, never floats. Follow the existing scaling conventions (`x18`, USDC 6-decimal raw).

## Reporting bugs

Open an issue with: what you expected, what happened, and the minimal steps to reproduce (including the command and environment). For anything that could affect funds or security, please flag it clearly in the issue title.

## License

By contributing, you agree that your contributions are licensed under the repository's [BUSL-1.1](LICENSE) license.
