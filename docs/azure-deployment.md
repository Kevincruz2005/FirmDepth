# Protected Settlement: local validation and Azure deployment

The protected local Base fork has passed both payout paths, expiry refunds, recipient receipts and failure rollback. The Azure ZIP was built and extracted into a temporary directory; its SDK/viem imports and manifest were validated independently. The existing public Sepolia core deployment was authenticated at block 12077537 on November 6, 2026. No public wrapper or Azure App Service was deployed in that validation.

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

The Azure name in `.env` is proposed configuration until resource creation succeeds. Do not describe its URL as deployed before successful Azure deployment and live health verification.
