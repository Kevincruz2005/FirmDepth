#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_PATH="${1:-$REPO_ROOT/.azure-package/firmdepth-quote-service.zip}"
STAGING_DIR="$(mktemp -d /tmp/firmdepth-azure-package.XXXXXX)"
trap 'rm -rf "$STAGING_DIR"' EXIT

node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(m.status!=='ready') throw new Error('Sepolia manifest must be ready before Azure packaging')" "$REPO_ROOT/deployments/sepolia.json"

npm --prefix "$REPO_ROOT/packages/sdk" ci >&2
npm --prefix "$REPO_ROOT/packages/sdk" run build >&2
npm --prefix "$REPO_ROOT/packages/quote-service" ci >&2
npm --prefix "$REPO_ROOT/packages/quote-service" run build >&2

mkdir -p "$(dirname "$PACKAGE_PATH")"
node "$REPO_ROOT/infra/azure/bundle.mjs" "$STAGING_DIR" >&2
python3 - "$PACKAGE_PATH" <<'PYCLEAN'
import pathlib, sys
pathlib.Path(sys.argv[1]).unlink(missing_ok=True)
PYCLEAN
if command -v bsdtar >/dev/null 2>&1; then
  (cd "$STAGING_DIR" && bsdtar -a -cf "$PACKAGE_PATH" packages deployments)
elif command -v zip >/dev/null 2>&1; then
  (cd "$STAGING_DIR" && zip -qr "$PACKAGE_PATH" packages deployments)
else
  echo "Azure packaging requires bsdtar or zip" >&2
  exit 1
fi
echo "$PACKAGE_PATH"
