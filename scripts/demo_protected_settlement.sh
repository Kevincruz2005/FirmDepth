#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for package in contracts sdk quote-service frontend; do
  if [[ ! -d "packages/$package/node_modules" ]]; then npm --prefix "packages/$package" ci --no-audit --no-fund; fi
done
npm --prefix packages/sdk run build
npm --prefix packages/contracts test
npm --prefix packages/sdk test
npm --prefix packages/quote-service run build
npm --prefix packages/quote-service test
npm --prefix packages/frontend test
npm --prefix packages/frontend run build
npm --prefix packages/benchmark test
if curl --silent --fail --max-time 2 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null; then
  echo 'Port 8545 already has an RPC. Stop it before starting a clean demonstration.' >&2
  exit 1
fi
export FIRMDEPTH_FORK_HOLDER="${FIRMDEPTH_FORK_HOLDER:-0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59}"
export FIRMDEPTH_FORK_RPC_URL=http://127.0.0.1:8545
node_log="$(mktemp /tmp/protected-node.XXXXXX)"
(cd packages/contracts && exec ./node_modules/.bin/hardhat node --fork "${BASE_RPC_URL:-https://mainnet.base.org}" --fork-block-number 51123118 --chain-id 8453 --chain-type op --hostname 127.0.0.1 --port 8545) >"$node_log" 2>&1 &
node_pid=$!
cleanup() { if [[ "${KEEP_LOCAL_FORK:-0}" == "1" ]]; then echo "Local fork retained at $FIRMDEPTH_FORK_RPC_URL (PID $node_pid)."; return; fi; kill "$node_pid" 2>/dev/null || true; wait "$node_pid" 2>/dev/null || true; rm -f "$node_log" packages/frontend/.runtime/firmdepth.json; }
trap cleanup EXIT INT TERM
for attempt in $(seq 1 60); do
  if curl --silent --fail -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$FIRMDEPTH_FORK_RPC_URL" >/dev/null; then break; fi
  kill -0 "$node_pid" || exit 1
  sleep 1
done
FIRMDEPTH_LIVE_E2E=1 FIRMDEPTH_E2E_PORT=4174 npm --prefix packages/frontend run test:browser -- --workers=1
FIRMDEPTH_PROTECTED_E2E=1 FIRMDEPTH_E2E_PORT=4174 npm --prefix packages/frontend run test:browser -- --workers=1 protected-settlement
(cd packages/contracts && npx hardhat run scripts/setup-protected-fork.ts --network localBase && npx hardhat run scripts/demo-protected-fork.ts --network localBase && npx hardhat run scripts/verify-protected-fork.ts --network localBase)
echo 'Protected Settlement: both execution paths and recipient balances verified on a local Base fork.'
