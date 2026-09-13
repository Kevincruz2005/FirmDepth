#!/usr/bin/env bash
set -euo pipefail

for name in PUBLIC_FRONTEND_URL PUBLIC_API_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "DEMO NOT READY"
    echo "- $name is required"
    exit 1
  fi
done

npm --prefix packages/sdk run build >/dev/null
npm --prefix packages/quote-service run build >/dev/null
npm --prefix packages/quote-service run readiness
