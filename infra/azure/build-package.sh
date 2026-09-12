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

mkdir -p "$STAGING_DIR/packages/quote-service" "$STAGING_DIR/packages/sdk" "$STAGING_DIR/deployments" "$(dirname "$PACKAGE_PATH")"
cp -R "$REPO_ROOT/packages/quote-service/dist" "$REPO_ROOT/packages/quote-service/node_modules" "$STAGING_DIR/packages/quote-service/"
cp "$REPO_ROOT/packages/quote-service/package.json" "$REPO_ROOT/packages/quote-service/package-lock.json" "$STAGING_DIR/packages/quote-service/"
cp -R "$REPO_ROOT/packages/sdk/dist" "$STAGING_DIR/packages/sdk/"
cp "$REPO_ROOT/packages/sdk/package.json" "$STAGING_DIR/packages/sdk/"
cp "$REPO_ROOT/deployments/sepolia.json" "$STAGING_DIR/deployments/sepolia.json"
if command -v bsdtar >/dev/null 2>&1; then
  (cd "$STAGING_DIR" && bsdtar -a -cf "$PACKAGE_PATH" .)
elif command -v zip >/dev/null 2>&1; then
  (cd "$STAGING_DIR" && zip -qr "$PACKAGE_PATH" .)
else
  echo "Azure packaging requires bsdtar or zip" >&2
  exit 1
fi
echo "$PACKAGE_PATH"
