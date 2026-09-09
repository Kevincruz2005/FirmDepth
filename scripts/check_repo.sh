#!/usr/bin/env bash
set -euo pipefail

echo "== Git status =="
git status --short || true

echo
echo "== Secret-like tracked files =="
git ls-files | grep -E '(^|/)\.env$|\.pem$|\.key$|keystore' && {
  echo "Potential secret-bearing tracked file detected."
  exit 1
} || true

echo
echo "== TODO/PENDING markers =="
git grep -nE 'PENDING|TODO|FIXME' -- ':!ERROR_LOG.md' ':!scripts/check_repo.sh' || true

echo
echo "Run the project-specific full tests before submission."
