#!/usr/bin/env bash
set -euo pipefail

for name in AZURE_RESOURCE_GROUP AZURE_APP_NAME CORS_ORIGINS; do
  if [[ -z "${!name:-}" ]]; then echo "$name is required" >&2; exit 1; fi
done
az webapp config appsettings set --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --settings CORS_ORIGINS="$CORS_ORIGINS" --output none
az webapp restart --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --output none
echo "Configured exact origins: $CORS_ORIGINS"
