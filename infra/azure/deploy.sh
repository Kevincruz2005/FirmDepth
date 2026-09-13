#!/usr/bin/env bash
set -euo pipefail

for name in AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP AZURE_LOCATION AZURE_PLAN AZURE_APP_NAME AZURE_KEY_VAULT MAKER_PRIVATE_KEY SEPOLIA_RPC_URL PUBLIC_BROWSER_RPC_URL PUBLIC_API_URL; do
  if [[ -z "${!name:-}" ]]; then echo "$name is required" >&2; exit 1; fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:4173}"
AZURE_NODE_RUNTIME="${AZURE_NODE_RUNTIME:-NODE|22-lts}"
PACKAGE_PATH="$($REPO_ROOT/infra/azure/build-package.sh)"

az account set --subscription "$AZURE_SUBSCRIPTION_ID"
AVAILABLE_RUNTIMES="$(az webapp list-runtimes --os linux --query '[].config' --output tsv)"
if ! rg -Fxq "$AZURE_NODE_RUNTIME" <<<"$AVAILABLE_RUNTIMES"; then
  echo "AZURE_NODE_RUNTIME=$AZURE_NODE_RUNTIME is not supported. Choose a Node 22+ LTS value from: az webapp list-runtimes --os linux" >&2
  exit 1
fi

az group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --output none
az appservice plan create --name "$AZURE_PLAN" --resource-group "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --is-linux --sku B1 --output none
az webapp create --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --plan "$AZURE_PLAN" --runtime "$AZURE_NODE_RUNTIME" --output none
az webapp update --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --https-only true --output none
PRINCIPAL_ID="$(az webapp identity assign --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --query principalId --output tsv)"

az keyvault create --name "$AZURE_KEY_VAULT" --resource-group "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --enable-rbac-authorization true --enable-purge-protection true --retention-days 90 --output none
VAULT_ID="$(az keyvault show --name "$AZURE_KEY_VAULT" --resource-group "$AZURE_RESOURCE_GROUP" --query id --output tsv)"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Key Vault Secrets User" --scope "$VAULT_ID" --output none
SIGNED_IN_ID="$(az ad signed-in-user show --query id --output tsv)"
az role assignment create --assignee-object-id "$SIGNED_IN_ID" --assignee-principal-type User --role "Key Vault Secrets Officer" --scope "$VAULT_ID" --output none
az keyvault secret set --vault-name "$AZURE_KEY_VAULT" --name maker-private-key --value "$MAKER_PRIVATE_KEY" --output none
az keyvault secret set --vault-name "$AZURE_KEY_VAULT" --name sepolia-rpc-url --value "$SEPOLIA_RPC_URL" --output none

az extension add --name application-insights --upgrade --only-show-errors
az monitor app-insights component create --app "$AZURE_APP_NAME" --location "$AZURE_LOCATION" --resource-group "$AZURE_RESOURCE_GROUP" --application-type web --output none
APPINSIGHTS_CONNECTION="$(az monitor app-insights component show --app "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --query connectionString --output tsv)"
VAULT_URI="$(az keyvault show --name "$AZURE_KEY_VAULT" --query properties.vaultUri --output tsv)"
MANIFEST_REVISION="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/deployments/sepolia.json','utf8')).manifestRevision")"
az webapp config appsettings set --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --settings \
  NODE_ENV=production \
  PUBLIC_BROWSER_RPC_URL="$PUBLIC_BROWSER_RPC_URL" \
  PUBLIC_API_URL="$PUBLIC_API_URL" \
  CORS_ORIGINS="$CORS_ORIGINS" \
  FIRMDEPTH_MANIFEST_PATH=/home/site/wwwroot/deployments/sepolia.json \
  FIRMDEPTH_MANIFEST_REVISION="$MANIFEST_REVISION" \
  MAKER_PRIVATE_KEY="@Microsoft.KeyVault(SecretUri=${VAULT_URI}secrets/maker-private-key/)" \
  SEPOLIA_RPC_URL="@Microsoft.KeyVault(SecretUri=${VAULT_URI}secrets/sepolia-rpc-url/)" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$APPINSIGHTS_CONNECTION" \
  --output none
az webapp config set --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --startup-file "cd /home/site/wwwroot/packages/quote-service && node dist/server.js" --always-on true --output none

az webapp deploy --name "$AZURE_APP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --src-path "$PACKAGE_PATH" --type zip --clean true --restart true --output none
echo "Quote service deployed to $PUBLIC_API_URL"
