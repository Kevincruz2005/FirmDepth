#!/usr/bin/env bash
set -euo pipefail

echo "Aqua HEAD:"
git ls-remote https://github.com/1inch/aqua HEAD

echo
echo "SwapVM HEAD:"
git ls-remote https://github.com/1inch/swap-vm HEAD

echo
echo "1inch SDKs HEAD:"
git ls-remote https://github.com/1inch/sdks HEAD

echo
echo "Copy the exact SHAs into docs/UPSTREAM_VERSIONS.md."
