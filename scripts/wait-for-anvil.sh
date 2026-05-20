#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${RPC_URL:-http://localhost:8545}"
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"

echo "Waiting for anvil at $RPC_URL ..."

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -s -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      "$RPC_URL" | grep -q '"result"'; then
    echo "anvil ready."
    exit 0
  fi
  sleep 1
done

echo "anvil did not become ready within ${TIMEOUT_SEC}s" >&2
exit 1
