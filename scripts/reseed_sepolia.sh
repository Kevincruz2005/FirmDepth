#!/usr/bin/env bash
set -euo pipefail

# Reconciliation is intentionally the same idempotent operation as setup. It
# pushes only missing virtual balances into active strategies and never docks.
exec "$(dirname "${BASH_SOURCE[0]}")/setup_sepolia.sh"
