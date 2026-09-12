#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then echo "SEPOLIA_RPC_URL is required" >&2; exit 1; fi
npm --prefix packages/sdk run build >/dev/null
npm --prefix packages/contracts run testnet:verify
