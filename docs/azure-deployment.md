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
