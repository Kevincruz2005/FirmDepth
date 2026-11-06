#!/usr/bin/env bash
set -euo pipefail
umask 077
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
FORK_AZURE_RESOURCE_GROUP="${FORK_AZURE_RESOURCE_GROUP:-firmdepth-debt-demo-rg}"
FORK_AZURE_PLAN="${FORK_AZURE_PLAN:-firmdepth-debt-demo-plan}"
FORK_AZURE_APP_NAME="${FORK_AZURE_APP_NAME:-firmdepth-debt-3207de}"
FORK_AZURE_LOCATION="${FORK_AZURE_LOCATION:-centralindia}"
if [[ "$FORK_AZURE_RESOURCE_GROUP" == firmdepth-mumbai-rg || "$FORK_AZURE_APP_NAME" == firmdepth-api-3207de ]]; then echo 'The fork must not target the existing production resources.' >&2; exit 1; fi
az account show --query state --output tsv
unset VITE_FIRMDEPTH_API_URL
export FORK_SOURCE_COMMIT="$(git rev-parse HEAD)"
npm --prefix packages/sdk run build
npm --prefix packages/quote-service run build
npm --prefix packages/frontend run build
node --test infra/azure/fork/policy.test.mjs
node infra/azure/build-fork-package.mjs
python3 infra/azure/archive-fork-package.py .azure-package/hosted-debt .azure-package/hosted-debt.zip
python3 - <<'PY'
from pathlib import Path
import secrets
p=Path('.azure-package/debt-operator.env')
if not p.exists():p.write_text('FORK_OPERATOR_TOKEN='+secrets.token_hex(32)+'\n')
p.chmod(0o600)
PY
set -a
source .azure-package/debt-operator.env
set +a
az group create --name "$FORK_AZURE_RESOURCE_GROUP" --location "$FORK_AZURE_LOCATION" --tags purpose=firmdepth-hosted-fork evidence=controlled-demo --output none
az appservice plan create --name "$FORK_AZURE_PLAN" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --location "$FORK_AZURE_LOCATION" --is-linux --sku B1 --output none
az webapp create --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --plan "$FORK_AZURE_PLAN" --runtime 'NODE:24-lts' --output none
FORK_HOST="$(az webapp show --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --query defaultHostName --output tsv)"
export FORK_PUBLIC_ORIGIN="https://$FORK_HOST"
settings_file="$(mktemp /tmp/firmdepth-fork-settings.XXXXXX)"
trap 'rm -f "$settings_file"' EXIT
python3 - "$settings_file" <<'PY'
import json,os,sys
settings={'NODE_ENV':'production','NODE_OPTIONS':'--dns-result-order=ipv4first','FORK_OPERATOR_TOKEN':os.environ['FORK_OPERATOR_TOKEN'],'FORK_PUBLIC_ORIGIN':os.environ['FORK_PUBLIC_ORIGIN'],'FORK_SOURCE_COMMIT':os.environ['FORK_SOURCE_COMMIT'],'BASE_RPC_URL':os.environ.get('BASE_RPC_URL') or 'https://mainnet.base.org','FORK_LOG_DIR':'/home/LogFiles/firmdepth-fork','WEBSITES_CONTAINER_START_TIME_LIMIT':'600','WEBSITE_DISABLE_MSI':'true','SCM_DO_BUILD_DURING_DEPLOYMENT':'false','ENABLE_ORYX_BUILD':'false'}
with open(sys.argv[1],'w') as file:json.dump(settings,file)
PY
az webapp update --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --https-only true --output none
az webapp config appsettings set --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --settings "@$settings_file" --output none
az webapp config set --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --startup-file 'cd /home/site/wwwroot && node infra/azure/fork/server.mjs' --always-on true --ftps-state Disabled --min-tls-version 1.2 --output none
az webapp deploy --name "$FORK_AZURE_APP_NAME" --resource-group "$FORK_AZURE_RESOURCE_GROUP" --src-path .azure-package/hosted-debt.zip --type zip --clean true --restart true --enable-kudu-warmup false --output none
echo "Hosted fork uploaded to $FORK_PUBLIC_ORIGIN. Require /health ready, then run the authenticated proof and verify the resulting receipts."
