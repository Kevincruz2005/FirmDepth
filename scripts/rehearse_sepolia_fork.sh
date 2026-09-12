#!/usr/bin/env bash
set -euo pipefail

for name in SEPOLIA_RPC_URL MAKER_PRIVATE_KEY; do
  if [[ -z "${!name:-}" ]]; then echo "$name is required" >&2; exit 1; fi
done
npm --prefix packages/sdk run build >/dev/null
npm --prefix packages/contracts run testnet:rehearse-fork
