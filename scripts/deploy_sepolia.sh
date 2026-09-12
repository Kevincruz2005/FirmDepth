#!/usr/bin/env bash
set -euo pipefail

for name in SEPOLIA_RPC_URL SEPOLIA_DEPLOYER_PRIVATE_KEY MAKER_PRIVATE_KEY AQUA_ADDRESS WETH_ADDRESS USDC_ADDRESS MAX_QUOTE_TTL; do
  if [[ -z "${!name:-}" ]]; then echo "$name is required" >&2; exit 1; fi
done
if [[ "$MAX_QUOTE_TTL" != "120" ]]; then echo "MAX_QUOTE_TTL must be exactly 120" >&2; exit 1; fi

npm --prefix packages/contracts run testnet:check
npm --prefix packages/contracts run testnet:parameters
npm --prefix packages/contracts run deploy:sepolia
npm --prefix packages/contracts run testnet:record
npm --prefix packages/sdk run build
npm --prefix packages/contracts run testnet:setup
npm --prefix packages/contracts run testnet:verify

echo "Sepolia deployment and maker setup are recorded in deployments/sepolia.json"
