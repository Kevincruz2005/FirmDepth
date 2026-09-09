#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

echo "[1/5] Compile FirmDepth and pinned Aqua/SwapVM integration"
npm --prefix "$KIT_DIR/packages/contracts" run compile

echo "[2/5] Reproduce shared virtual depth exceeding real maker inventory"
(
  cd "$KIT_DIR/packages/contracts"
  npx hardhat test solidity --grep "testOfficialAquaSoftDepthCanExceedRealSharedInventory"
)

echo "[3/5] Prove official Aqua success with onchain token transfers"
(
  cd "$KIT_DIR/packages/contracts"
  npx hardhat test solidity --grep "testAquaPathUsesOfficialAquaAndUnlocksBond"
)

echo "[4/5] Prove collateral-backed settlement after capacity removal"
(
  cd "$KIT_DIR/packages/contracts"
  npx hardhat test solidity --grep "testBondPathWhenRealAllowanceIsRemoved"
)

echo "[5/5] Validate the frontend-facing TypeScript SDK"
npm --prefix "$KIT_DIR/packages/sdk" run build
npm --prefix "$KIT_DIR/packages/sdk" test

echo "FirmDepth backend demo checks passed."
