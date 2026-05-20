#!/usr/bin/env bash
# Deploy Perplex contracts to Arbitrum Sepolia.
#
# Default behaviour: DRY RUN (forge simulates and prints the broadcast plan but does not send).
# Pass --broadcast as the first argument to actually submit transactions.
#
# Required env:
#   DEPLOYER_PRIVATE_KEY     hot deployer key, MUST hold Sepolia ETH for gas
#   ARBITRUM_SEPOLIA_RPC_URL public RPC for Arbitrum Sepolia
# Optional env:
#   ARBISCAN_API_KEY  for source verification via --verify
set -euo pipefail

MODE="${1:-dry-run}"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "ERROR: DEPLOYER_PRIVATE_KEY is required" >&2
  exit 2
fi
if [[ -z "${ARBITRUM_SEPOLIA_RPC_URL:-}" ]]; then
  echo "ERROR: ARBITRUM_SEPOLIA_RPC_URL is required" >&2
  exit 2
fi

DEPLOYER_ADDR=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")
BAL=$(cast balance --rpc-url "${ARBITRUM_SEPOLIA_RPC_URL}" "${DEPLOYER_ADDR}")
echo "deployer ${DEPLOYER_ADDR}"
echo "balance  ${BAL} wei (Sepolia ETH)"

if [[ "${BAL}" == "0" ]]; then
  echo "ERROR: deployer has zero Sepolia ETH. Fund from https://www.alchemy.com/faucets/arbitrum-sepolia" >&2
  exit 3
fi

cd "$(dirname "$0")/../contracts"

ARGS=(
  forge script script/Deploy.s.sol
  --rpc-url "${ARBITRUM_SEPOLIA_RPC_URL}"
  --slow
  -vvv
)

case "${MODE}" in
  dry-run)
    echo ""
    echo "MODE: dry-run (simulating only). Pass --broadcast to send."
    "${ARGS[@]}"
    ;;
  --broadcast)
    echo ""
    echo "MODE: BROADCAST. Submitting transactions to Arbitrum Sepolia."
    EXTRA=("--broadcast")
    if [[ -n "${ARBISCAN_API_KEY:-}" ]]; then
      EXTRA+=("--verify" "--etherscan-api-key" "${ARBISCAN_API_KEY}")
    fi
    "${ARGS[@]}" "${EXTRA[@]}"
    ;;
  *)
    echo "Usage: $0 [--broadcast]" >&2
    exit 1
    ;;
esac
