# Protected Settlement: local validation and Azure deployment

The protected local Base fork has passed both payout paths, expiry refunds, recipient receipts and failure rollback. On November 6, 2026, the new wrapper was deployed against the preserved public Sepolia core and an actual Aqua settlement paid 1.5/1.0 USDC. The Azure API now passes HTTPS health, deployment authentication and genuine maker-signature verification. Public deployment and payout receipts are recorded in [`protected-sepolia.json`](../deployments/protected-sepolia.json).

A git-ignored `.env` contains concrete Azure names and public RPC defaults. It has permissions 0600. Fill `MAKER_PRIVATE_KEY` with the key controlling the existing manifest maker and `SEPOLIA_DEPLOYER_PRIVATE_KEY` with a funded Sepolia deployer. Do not commit these values or paste them into chat. Azure login authenticates Azure resource access; it does not supply blockchain signing keys.

Load the file explicitly:

```bash
set -a
source .env
set +a
```

Deploy only the new wrapper against the preserved public Sepolia core:

```bash
cd packages/contracts
npx hardhat run scripts/deploy-protected-sepolia.ts --network sepolia
cd ../..
```

The script validates chain/core identity, confirms deployer funding, deploys ProtectedSettlement, verifies its relationships, and writes `deployments/protected-sepolia.json` with the actual address, block and transaction hash. A previously recorded compatible deployment is reused. It does not change the old `deployments/sepolia.json` manifest.

Copy the resulting address into `FIRMDEPTH_SETTLEMENT_ADDRESS` in the ignored `.env` and reload it. Run the genuine quote service locally before cloud deployment:

```bash
PUBLIC_API_URL=http://127.0.0.1:8080 npm --prefix packages/quote-service start
```

Use the production API mode of the frontend (`VITE_FIRMDEPTH_API_URL=http://127.0.0.1:8080`) to verify runtime, signer, quote inspection and wallet transactions against public Sepolia. Test amounts must fit the existing small Sepolia liquidity/bond policy. A public sibling-drain demo consumes shared inventory, so use the isolated local fork for adversarial demonstrations and keep the public demo supplied with liquidity.

Then deploy the backend:

```bash
./infra/azure/deploy.sh
```

The deploy script validates signer/core/wrapper/browser RPC and origins before creating resources. It uses a supported Node 24 runtime, Key Vault references and managed identity, and passes the protected wrapper address to the service. Secret upload uses temporary 0600 files, not secret command-line arguments. The checked-in packaging manifest contains public contract metadata only.

After Azure startup, verify `/health` reports `status: ok` and `deploymentAuthenticated: true`, verify `/runtime` contains the expected `settlement.address`, and request a genuine signed quote for a funded onchain plan. Configure the frontend's API origin to the returned Azure endpoint and set exact frontend origins in Azure CORS. A loopback fork endpoint cannot serve Azure; the Azure backend uses public Sepolia RPC.

The verified API is `https://firmdepth-api-3207de.azurewebsites.net`. `/runtime` reports chain 11155111 and wrapper `0x4c7296156a385a6487aD7FF38C328EdCf6584c79`. A genuine signed quote was verified at block 12077998. A separately funded protected plan obtained a valid Azure quote naming this contract as taker; its unaccepted WETH was refunded in transaction `0x96f1db2dea8e5a496a1294705404f2534ed74cc436ca168c96839bd45161d375`. That probe did not execute a swap or consume collateral.

## Deployment packaging

The Azure package bundles the backend into a standalone Node 22+ ESM server and includes only package metadata and the public Sepolia manifest. Local artifact validation includes a genuine signed quote. The small package deploys directly through ZIP deployment; no runtime dependency installation or package-mount configuration is needed. Maker and RPC credentials remain Key Vault references.

Azure allows up to 600 seconds for a cold start. No custom warm-up status filter is set. Deployment readiness requires a separate authenticated HTTPS health and signed-quote check. Resource creation or a successful upload alone does not establish readiness.

On this Central India App Service worker, Node started correctly but the local MSI token sidecar never completed its startup probe. `AZURE_DISABLE_LOCAL_MSI=true` sets `WEBSITE_DISABLE_MSI=true`, disabling that local token endpoint while retaining the assigned identity and platform Key Vault references. Both references remained `Resolved` and real signed quotes passed afterward. This service does not call Azure token APIs. Keep this opt-in workaround documented; remove it when the worker supports normal sidecar startup, and do not enable it for an application that needs the local token endpoint. See Microsoft's [App Service identity documentation](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).

The private RPC requires IPv4-first DNS resolution in this environment; deploy.sh sets `NODE_OPTIONS=--dns-result-order=ipv4first`. The browser receives only `PUBLIC_BROWSER_RPC_URL`, never the private credential-bearing RPC.

## Public frontend

The application is hosted at `https://firmdepthpkg3207de.z29.web.core.windows.net/settlement`; the local production preview at `http://127.0.0.1:4173/settlement` uses the same Azure API. Only compiled `packages/frontend/dist` assets are uploaded. Exact route blobs return HTTP 200 for direct navigation. Unknown routes render the app's not-found page through the storage error document. No private RPC or signing key is embedded in the build.

To reproduce on an existing StorageV2 account, export `AZURE_FRONTEND_STORAGE_ACCOUNT`, install frontend dependencies, build the SDK, then run:

```bash
npm --prefix packages/frontend ci
npm --prefix packages/sdk run build
./infra/azure/deploy-frontend.sh
```

The script grants the signed-in deployment user Storage Blob Data Contributor scoped to this account, enables static website hosting, uploads compiled assets, and adds the exact website origin to API CORS. An account can be provisioned with `az storage account create --name "$AZURE_FRONTEND_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --sku Standard_LRS --kind StorageV2 --https-only true --min-tls-version TLS1_2 --allow-blob-public-access false`. Storage website content is deliberately public. Do not upload repository roots, `.env`, package archives or backend files to `$web`.

Run the read-only deployment gates:

```bash
./scripts/check_public_demo_readiness.sh
FIRMDEPTH_PUBLIC_E2E=1 FIRMDEPTH_E2E_BASE_URL="$PUBLIC_FRONTEND_URL" \
  npm --prefix packages/frontend run test:browser -- --grep 'public protected deployment'
```

The browser suite checks authenticated runtime, correct contract taker, scaled public payout defaults, direct routes, mobile layout and recovery of the actual paid plan's verified ERC-20 receipt. Receipt inspection uses a read-only account-discovery fixture; it cannot sign or submit transactions. Full frontend wallet transactions through Aqua, bond fallback and expiry are exercised separately by the local-fork browser suite.

## Real public payout reproduction

The following sends real Sepolia transactions using the exported deployer key. It uses an Azure maker-signed quote, immutable 0.12/0.08 USDC allocations to payer/maker, a 0.0001 WETH input and a 0.00002 WETH premium budget:

```bash
RESEED_AFTER_DEMO=1 node scripts/demo_protected_sepolia.mjs
```

`RESEED_AFTER_DEMO=1` also requires the maker key and restores only consumed Firm virtual USDC output to the existing manifest target, using Aqua `push`. It leaves the core manifest, programs and public deployment addresses unchanged. The latest restoration is transaction `0xc051aa2c4d5b502a519ab8cd8e289d96df23adcce77b854238897fe2f8a526eb`. Public demonstrations consume inventory, so rerun readiness afterward.

Each submitted hash and the plan ID are saved in the ignored `.azure-package/public-payout-session.json` before waiting for its receipt. If the process stops, inspect that journal and resume with `SETTLEMENT_DEMO_PLAN_ID=<recorded-plan-id>` rather than creating or paying a second plan. A funded unaccepted plan can be refunded immediately by its payer; accepted principal can be refunded after the signed quote expires. SDK verification uses the registry's recorded acceptance block, supporting the private provider's 10-block log limit. Verified public evidence is written to `packages/contracts/evidence/protected-settlement-sepolia.json` only after full receipt checks.

The Azure-issued acceptance is `0x113820e30c8f2de1ef31fa3a0ef868282586d4fd879f38422624ea800e5fb8c5`; execution is `0xa8096213cdedd078b4ae011a152469e116107e193870e5c843e52887b4bc7490`. This is public Sepolia Aqua execution. The public site does not claim a public sibling drain or public bond execution; those adversarial paths are demonstrated with real token transfers on the pinned local Base fork.

The browser RPC is `https://ethereum-sepolia-rpc.publicnode.com`, on which the current protected deployment browser checks passed. It omits the historical September receipt, which the private backend RPC retains. A candidate keyless archival endpoint returned that receipt and authenticated the core/wrapper, but rate-limited the full regression. It was not retained as the default. A browser RPC must support historical transactions as well as current reads; keep this separate from private backend RPC credentials.

The full original public-Sepolia regression encounters a missing historical receipt on PublicNode and `rate limit exceeded` on the candidate archival endpoint; later serial checks are then skipped. The core/local-fork suites and real public payout remain verified. Azure hosting is deployed and healthy, but the complete public regression gate must not be reported as passed until a browser-safe archival RPC with sufficient request capacity is configured. Never publish the existing private RPC credentials as a shortcut.
