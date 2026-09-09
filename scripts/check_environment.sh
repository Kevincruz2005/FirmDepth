#!/usr/bin/env bash
set -euo pipefail

echo "== FirmDepth environment check =="

for cmd in git node npm; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[ok] $cmd: $($cmd --version 2>/dev/null | head -n1)"
  else
    echo "[missing] $cmd"
  fi
done

for cmd in yarn pnpm forge cast anvil npx; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[ok] $cmd: $($cmd --version 2>/dev/null | head -n1 || true)"
  else
    echo "[optional/missing] $cmd"
  fi
done

echo
echo "RPC_URL: ${RPC_URL:+set}${RPC_URL:-not set}" | sed 's#https\?://.*#set#'
echo "Do not print private keys."
