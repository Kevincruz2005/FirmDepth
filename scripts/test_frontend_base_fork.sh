#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
SDK_DIR="$ROOT_DIR/packages/sdk"
FRONTEND_DIR="$ROOT_DIR/packages/frontend"
FORK_RPC_URL="http://127.0.0.1:8545"
FORK_LOG="$(mktemp /tmp/firmdepth-base-fork.XXXXXX.log)"

cleanup() {
  if [[ -n "${FORK_PID:-}" ]] && kill -0 "$FORK_PID" 2>/dev/null; then
    kill "$FORK_PID" 2>/dev/null || true
    wait "$FORK_PID" 2>/dev/null || true
  fi
  rm -f "$FRONTEND_DIR/.runtime/firmdepth.json"
}
trap cleanup EXIT INT TERM

npm --prefix "$SDK_DIR" run build
npm --prefix "$CONTRACTS_DIR" run compile

(
  cd "$CONTRACTS_DIR"
  npx hardhat node \
    --fork "${BASE_RPC_URL:-https://mainnet.base.org}" \
    --fork-block-number 51123118 \
    --chain-id 8453 \
    --chain-type op \
    --hostname 127.0.0.1 \
    --port 8545
) >"$FORK_LOG" 2>&1 &
FORK_PID=$!

for _ in $(seq 1 45); do
  if curl --silent --fail --request POST \
    --header 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$FORK_RPC_URL" >/dev/null; then
    break
  fi
  if ! kill -0 "$FORK_PID" 2>/dev/null; then
    sed -n '1,240p' "$FORK_LOG" >&2
    exit 1
  fi
  sleep 1
done

(
  cd "$CONTRACTS_DIR"
  FIRMDEPTH_FORK_RPC_URL="$FORK_RPC_URL" npx hardhat run scripts/check-base-fork.ts --network localBase
)

FIRMDEPTH_LIVE_E2E=1 PLAYWRIGHT_CHROME_PATH="${PLAYWRIGHT_CHROME_PATH:-/usr/bin/google-chrome-stable}" \
  npm --prefix "$FRONTEND_DIR" run test:browser -- --workers=1
