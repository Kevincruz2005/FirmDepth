#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for package in contracts sdk quote-service frontend; do
  if [[ ! -d "packages/$package/node_modules" ]]; then npm --prefix "packages/$package" ci --no-audit --no-fund; fi
done
unset VITE_FIRMDEPTH_API_URL
export BASE_RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
export BASE_FORK_BLOCK=51123118
export FIRMDEPTH_FORK_HOLDER="${FIRMDEPTH_FORK_HOLDER:-0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59}"
export FIRMDEPTH_FORK_RPC_URL=http://127.0.0.1:8545
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"
npm --prefix packages/sdk run build
npm --prefix packages/contracts test
npm --prefix packages/sdk test
npm --prefix packages/quote-service run build
npm --prefix packages/quote-service test
npm --prefix packages/frontend test
npm --prefix packages/frontend run build
npm --prefix packages/frontend run lint
npm --prefix packages/benchmark test
if curl --silent --fail --max-time 2 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$FIRMDEPTH_FORK_RPC_URL" >/dev/null; then
  echo 'Port 8545 already has an RPC. Stop the existing local node before a clean debt demonstration.' >&2
  exit 1
fi
node_log="$(mktemp /tmp/firmdepth-debt-node.XXXXXX)"
# The named network reads BASE_RPC_URL from the environment, keeping credential
# bearing archive URLs out of process arguments and generated public artifacts.
(cd packages/contracts && exec ./node_modules/.bin/hardhat node --network debtFork --hostname 127.0.0.1 --port 8545) >"$node_log" 2>&1 &
node_pid=$!
cleanup(){
  if [[ "${KEEP_LOCAL_FORK:-0}" == "1" ]] && kill -0 "$node_pid" 2>/dev/null; then echo "Local debt fork retained at $FIRMDEPTH_FORK_RPC_URL (PID $node_pid)."; return; fi
  kill "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
  rm -f "$node_log" packages/frontend/.runtime/firmdepth.json
}
trap cleanup EXIT INT TERM
ready=0
for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 2 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$FIRMDEPTH_FORK_RPC_URL" >/dev/null; then ready=1; break; fi
  if ! kill -0 "$node_pid" 2>/dev/null; then echo "Archive RPC startup failed; private diagnostic: $node_log" >&2; exit 1; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then echo "Local fork startup timed out; private diagnostic: $node_log" >&2; exit 1; fi
FIRMDEPTH_LIVE_E2E=1 FIRMDEPTH_E2E_PORT=4174 npm --prefix packages/frontend run test:browser -- --workers=1
FIRMDEPTH_PROTECTED_E2E=1 FIRMDEPTH_E2E_PORT=4174 npm --prefix packages/frontend run test:browser -- --workers=1 protected-settlement
FIRMDEPTH_DEBT_E2E=1 FIRMDEPTH_E2E_PORT=4174 npm --prefix packages/frontend run test:browser -- --workers=1 debt-repayment
(cd packages/contracts && npx hardhat run scripts/setup-debt-fork.ts --network localBase && npx hardhat run scripts/demo-debt-fork.ts --network localBase && npx hardhat run scripts/verify-debt-fork.ts --network localBase)
if [[ "${KEEP_LOCAL_FORK:-0}" == "1" ]]; then
  # Leave a fresh funded maker and actual 600-USDC borrower position for the UI.
  # Preserve and reverify the completed demonstration at its historical blocks.
  (cd packages/contracts && npx hardhat run scripts/setup-debt-fork.ts --network localBase && npx hardhat run scripts/verify-debt-fork.ts --network localBase)
fi
echo 'Protected debt repayment: real Aave debt reduced through Aqua and covered bond; original payout regressions and atomic rollback verified.'
if [[ "${KEEP_LOCAL_FORK:-0}" == "1" ]]; then
  echo "Verified local fork remains running at $FIRMDEPTH_FORK_RPC_URL (PID $node_pid). Keep this terminal open; start the frontend in another terminal."
  wait "$node_pid"
fi
