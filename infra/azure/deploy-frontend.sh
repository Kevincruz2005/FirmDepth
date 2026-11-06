#!/usr/bin/env bash
set -euo pipefail

for name in AZURE_RESOURCE_GROUP AZURE_APP_NAME AZURE_FRONTEND_STORAGE_ACCOUNT PUBLIC_API_URL; do
  if [[ -z "${!name:-}" ]]; then echo "$name is required" >&2; exit 1; fi
done
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The storage account must already exist; use a dedicated StorageV2 account.
FRONTEND_URL="$(az storage account show --name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP" --query primaryEndpoints.web --output tsv)"
FRONTEND_ORIGIN="${FRONTEND_URL%/}"
STORAGE_ID="$(az storage account show --name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP" --query id --output tsv)"
SIGNED_IN_ID="$(az ad signed-in-user show --query id --output tsv)"
az role assignment create --assignee-object-id "$SIGNED_IN_ID" --assignee-principal-type User --role 'Storage Blob Data Contributor' --scope "$STORAGE_ID" --output none
VITE_FIRMDEPTH_API_URL="$PUBLIC_API_URL" npm --prefix "$REPO_ROOT/packages/frontend" run build
az storage blob service-properties update --account-name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --auth-mode login --static-website --index-document index.html --404-document index.html --output none
for attempt in $(seq 1 12); do
  if az storage blob upload-batch --account-name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --auth-mode login --destination '$web' --source "$REPO_ROOT/packages/frontend/dist" --overwrite true --output none; then break; fi
  if [[ "$attempt" == 12 ]]; then exit 1; fi
  echo "Waiting for Storage role propagation ($attempt/12)" >&2
  sleep 5
done
# Exact route blobs make direct navigation return 200, without an SPA 404 fallback.
for route in settlement trade evidence maker docs; do
  az storage blob upload --account-name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --auth-mode login --container-name '$web' --name "$route" --file "$REPO_ROOT/packages/frontend/dist/index.html" --content-type 'text/html; charset=utf-8' --overwrite true --output none
done
NEXT_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:4173}"
if [[ ",$NEXT_ORIGINS," != *",$FRONTEND_ORIGIN,"* ]]; then NEXT_ORIGINS="$NEXT_ORIGINS,$FRONTEND_ORIGIN"; fi
CURRENT_ORIGINS="$(az webapp config appsettings list --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --query "[?name=='CORS_ORIGINS'].value | [0]" --output tsv)"
if [[ "$CURRENT_ORIGINS" != "$NEXT_ORIGINS" ]]; then
  az webapp config appsettings set --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --settings CORS_ORIGINS="$NEXT_ORIGINS" --output none
fi
echo "Frontend uploaded to $FRONTEND_ORIGIN; verify API health and browser runtime after the CORS restart."
