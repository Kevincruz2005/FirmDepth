#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

echo "[1/6] Compile FirmDepth and pinned Aqua/SwapVM integration"
npm --prefix "$KIT_DIR/packages/contracts" run compile

echo "[2/6] Run contract regression and invariant suites"
npm --prefix "$KIT_DIR/packages/contracts" test

echo "[3/6] Validate the frontend-facing TypeScript SDK"
npm --prefix "$KIT_DIR/packages/sdk" run build
npm --prefix "$KIT_DIR/packages/sdk" test

echo "[4/6] Verify official Aqua and SwapVM contracts on the pinned Base fork"
npm --prefix "$KIT_DIR/packages/contracts" run fork:base:check

echo "[5/6] Execute Soft failure, Firm Aqua, and Firm bond paths on the Base fork"
npm --prefix "$KIT_DIR/packages/contracts" run fork:base:demo

echo "[6/6] Regenerate and validate deterministic benchmark evidence"
npm --prefix "$KIT_DIR/packages/benchmark" run benchmark
npm --prefix "$KIT_DIR/packages/benchmark" test

echo "FirmDepth backend release gates passed."
