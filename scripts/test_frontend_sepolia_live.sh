#!/usr/bin/env bash
set -euo pipefail

for url in http://127.0.0.1:8080/health http://127.0.0.1:4173/; do
  if ! curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
    echo "Live Sepolia API and rebuilt frontend must already be running on ports 8080 and 4173." >&2
    exit 1
  fi
done

FIRMDEPTH_SEPOLIA_LIVE_E2E=1 FIRMDEPTH_E2E_PORT=4173 npm --prefix packages/frontend run test:browser -- --grep "read-only live Sepolia smoke"
