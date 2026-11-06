# FirmDepth

**Bond-backed execution certainty for 1inch Aqua**

FirmDepth adds a paid, fully collateralized execution class to Aqua's reusable liquidity. A trader accepts a maker-signed WETH-to-USDC quote, the protocol locks its USDC minimum output, and modified SwapVM instructions bind the swap to that exact commitment.

## Why it can win

Aqua lets a maker reuse wallet inventory across virtual strategies. That is capital-efficient, but a Soft quote can lose execution capacity when a sibling strategy consumes the shared balance or allowance. Reserving the trading inventory would restore certainty by giving up Aqua's defining advantage.

FirmDepth instead reserves separate performance collateral only while a commitment is live:

- **Aqua path:** sufficient virtual balance, real wallet balance, and allowance execute through official Aqua with custom `FIRM_PRICE` and `FIRM_GUARD` SwapVM instructions.
- **Bond path:** an inactive strategy or deterministic output-capacity shortfall transfers the trader input to the maker and releases the locked USDC minimum to the trader.
- **Fail-closed path:** any unrelated token, router, malformed-program, or SwapVM failure reverts the entire transaction. It cannot consume the bond.

This keeps the maker's trading inventory reusable, makes accepted Firm commitments fully collateralized, and turns the key claim into reproducible onchain evidence rather than a UI promise.

Depth terminology is exact: **Virtual Depth** is Aqua's advertised output balance for the configured strategy; **Pullable Depth** is active `min(virtual balance, real inventory, Aqua allowance)`; **Firm Depth for a quote** is `min(Pullable Depth, floor(available Bond × minAmountOut / requiredBond))`. Firm Depth is deliberately quote-scoped because overcollateralized policies require more Bond than the promised output.

## Fresh-machine reproduction

Prerequisites are Node.js 22+, npm, Bash, `curl`, Chrome or a compatible executable, and an archive-capable Base RPC. `BASE_RPC_URL` must be exported into the shell; the repository does not automatically load `.env`. [`.env.example`](.env.example) is reference-only unless you manually export its values or supply them through your shell or other tooling. Do not commit RPC credentials.

```bash
git clone https://github.com/Kevincruz2005/FirmDepth.git
cd FirmDepth

npm --prefix packages/contracts ci --no-audit --no-fund
npm --prefix packages/sdk ci --no-audit --no-fund
npm --prefix packages/frontend ci --no-audit --no-fund

export BASE_RPC_URL='https://your-base-archive-rpc.example'

./scripts/test_frontend_base_fork.sh
```

The runner clears stale runtime state, starts a fresh Base fork pinned at block `51,123,118`, verifies official Aqua, SwapVM, WETH, and USDC bytecode, deploys FirmDepth, initializes deterministic fork state, generates the temporary runtime artifact, runs the full Playwright suite, and cleans up the artifact and child processes afterward. It does not depend on state from an earlier run. If Chrome is not installed at the runner's default `/usr/bin/google-chrome-stable`, export `PLAYWRIGHT_CHROME_PATH` with the path to a compatible executable before running the script.

For the backend-only release gate after installing the contract and SDK dependencies:

```bash
./scripts/demo_backend.sh
```

That gate compiles the contracts, runs the unit/fuzz tests, builds and tests the SDK, verifies the official sponsor contracts at the pinned Base block, executes the adversarial fork demo, then regenerates and validates the deterministic benchmark.

## Frontend

The product interface lives in `packages/frontend` and separates every displayed value into Live, Verified Base-fork Run, Synthetic Benchmark, or Illustrative evidence. It includes the product narrative at `/`, Soft/Firm execution at `/trade`, strict terminal receipt inspection at `/evidence`, and maker bond controls at `/maker`.

Production hosting routes unknown document requests to `packages/frontend/dist/index.html` so direct navigation to `/trade`, `/evidence`, and `/maker` reaches the client router. Live Trade and Maker actions require an authenticated schema-v2 runtime, a browser-safe RPC, deployed and configured FirmDepth contracts and strategies, and the maker-operated service in `packages/quote-service`. The service accepts only `{ chainId, registry, strategyId, orderHash, taker, amountIn, pricingTtl }` for the allowlisted deployment and returns a signed `{ quote, makerSignature, quotedAtBlock }`. It derives output from the configured live Soft SwapVM strategy and uses the SDK for pricing, eligibility, quote construction, and EIP-712 signing. No maker key belongs in a browser deployment.

A public static deployment without that transaction infrastructure still provides the Landing page, committed `VERIFIED BASE-FORK RUN` evidence, and `SYNTHETIC BENCHMARK` evidence. Trade and Maker retain their explanatory states, but live transaction controls fail closed rather than substituting `ILLUSTRATIVE` values. The four evidence labels remain distinct: `LIVE`, `VERIFIED BASE-FORK RUN`, `SYNTHETIC BENCHMARK`, and `ILLUSTRATIVE`. The controlled environment is shown as `Base Fork · Block 51,123,118`, never as a public Base-mainnet execution.

Run the read-only product and evidence experience locally:

```bash
npm --prefix packages/sdk run build
npm --prefix packages/frontend ci
npm --prefix packages/frontend run dev
```

Run the complete UI against a fresh pinned Base fork, including real wallet-submitted acceptance, Aqua execution, bond settlement after a sibling Soft drain, expiry, atomic revert preservation, and maker vault actions:

```bash
./scripts/test_frontend_base_fork.sh
```

The fork runner creates a short-lived schema-v2 runtime artifact under the ignored `packages/frontend/.runtime/` directory. It contains public controlled-fork deployment and account addresses, environment metadata, strategy/order configuration, and runtime endpoints; it contains neither private keys nor a pre-signed maker quote. Dynamic demo quotes are generated on request by development-only Vite middleware, using the unlocked controlled-fork maker and the FirmDepth SDK. The middleware is not a production quote service and is not emitted in the production bundle. The runner removes the artifact when the test process exits.

For a focused judge demo:

```bash
npm --prefix packages/contracts run fork:base:check
npm --prefix packages/contracts run fork:base:demo
```

The fork demo discovers a real USDC holder from historical Base logs and uses real Base WETH, USDC, and official Aqua state. It proves:

1. a Firm commitment settles through Aqua;
2. one Soft strategy drains shared maker inventory;
3. its overlapping Soft sibling fails atomically onchain;
4. an already accepted Firm commitment settles exactly once from its locked bond;
5. a new under-capacity commitment is rejected;
6. final vault liabilities reconcile to the actual USDC balance.

## Core implementation

| Component | Purpose |
|---|---|
| [`FirmAquaSwapVMRouter.sol`](packages/contracts/contracts/FirmAquaSwapVMRouter.sol) | Extends the pinned official SwapVM router with `FIRM_PRICE` and `FIRM_GUARD`. |
| [`FirmExecutor.sol`](packages/contracts/contracts/FirmExecutor.sol) | Performs deterministic capacity classification and finalizes exactly one settlement path. |
| [`FirmCommitmentRegistry.sol`](packages/contracts/contracts/FirmCommitmentRegistry.sol) | Verifies EIP-712/ERC-1271 quotes, prevents replay, escrows token-in premiums, and owns commitment state. |
| [`BondVault.sol`](packages/contracts/contracts/BondVault.sol) | Maintains exact available/locked collateral accounting and commitment-specific locks. |
| [`FirmDepth.t.sol`](packages/contracts/test/FirmDepth.t.sol) | Covers official Aqua execution, custom instructions, lifecycle attacks, signatures, atomicity, and asset invariants. |
| [`actions.ts`](packages/sdk/src/actions.ts) | Simulates every state-changing Firm action before wallet submission. |
| [`receipt.ts`](packages/sdk/src/receipt.ts) | Reconciles terminal chain state with strict acceptance, execution, SwapVM, bond, and ERC-20 receipt evidence. |
| [`base-fork-demo.json`](packages/contracts/evidence/base-fork-demo.json) | Records the canonical Base fork transactions, gas, terminal states, and reconciled balances. |

## Verified implementation

- Solidity: 61/61 tests pass, including two vault/accounting invariants at 1,024 fuzz runs each.
- SDK: 28/28 tests pass after a clean build.
- Quote service: 6/6 boundary, signing, policy, capacity, and secret-redaction tests pass.
- Benchmark: 8/8 tests pass against the deterministic aggregate artifacts.
- Frontend unit: 10/10 tests pass.
- Base-fork Playwright: 19/19 checks pass—7 live fork/integration checks and 12 standalone browser, responsive, and accessibility checks.
- 810,000 seeded simulation episodes cover 81 parameter configurations across quote size, TTL, shared-liquidity ratio, and bond utilization.
- The highest-loss admitted benchmark scenario observes 5,853 Soft capacity losses out of 10,000 episodes; the same seeded Firm scenario settles 4,147 through Aqua and 5,853 through locked collateral. These are synthetic stress results, not claimed real-network failure rates.
- The canonical fork evidence uses Base chain ID `8453`, official Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`, official SwapVM `0x111111338c5091e8440b67b168bae16a668ac0de`, Base WETH, and Base USDC.

Benchmark inputs and outputs are in [`packages/benchmark/`](packages/benchmark/). Regenerate them with:

```bash
npm --prefix packages/benchmark run benchmark
npm --prefix packages/benchmark test
```

## Safety model

The backend targets exact-input WETH-to-USDC commitments. Every 22-field signed quote binds the chain, verifying contract, maker, taker, executor, router, order hash, token pair, amount, minimum output, expiry, nonce, bond, and immutable pricing snapshot. Pricing version 2 uses unsigned-integer fixed-point arithmetic; tokenOut-equivalent premium is converted to tokenIn with ceiling division. The signed `pricingTtl` fixes the quoted time horizon, so mining delay or later vault utilization cannot reprice an accepted commitment. The deterministic cross-language vector is [`firm-quote-golden.json`](packages/sdk/test/firm-quote-golden.json).

Acceptance requires an active Aqua strategy plus sufficient virtual balance, real maker balance, maker allowance, static quoted output, and free bond collateral. Execution rechecks only the deterministic Aqua capacity signals before pulling trader input. If capacity is sufficient, the Aqua call is deliberately not caught: unknown failures revert all nested and outer state. Reentrancy protection and single terminal states prevent dual settlement, replay, or double release.

### Preflight settlement boundary

Immediately before path selection, `FirmExecutor` validates the exact accepted order and reads the exact maker/router/order-hash strategy's token counts and virtual tokenOut balance, the maker's real tokenOut balance, and the maker's tokenOut allowance to Aqua. Effective capacity is the minimum of those three balances and is compared with this commitment's signed `minAmountOut`. Inactive token counts, including Aqua's docked sentinel, are classified separately from active but depleted capacity. A failed read reverts; it does not select Bond.

No external state-changing call occurs after this snapshot and before the trader input pull. The executor is non-reentrant, the accepted order forbids every maker hook, and its runtime taker traits forbid every callback. On the Aqua branch, `router.swap` is uncaught. Any instruction, native threshold/deadline, router, Aqua, token, empty-data, panic, or unknown failure therefore reverts the input pull and leaves commitment, premium, bond, allowance, and Aqua state unchanged.

### POST_ACCEPTANCE_STRATEGY_UNAVAILABILITY

A strategy inactive before acceptance is rejected. A strategy that was active, statically quotable, and fully executable when accepted may later be docked by its maker. The accepted commitment remains live and cannot be cancelled: matching taker, executor, router, exact order, deadline, and dedicated lock are still enforced, then the unavailable strategy selects `FILLED_BOND`. The trader pays the signed tokenIn amount, receives exactly `minAmountOut` from that commitment's lock, and the maker receives tokenIn plus the already reserved premium. This is maker-caused post-acceptance strategy unavailability, not sibling inventory depletion; both enforce the same pre-existing economic obligation.

### Premium and collateral lifecycle

Acceptance atomically locks `requiredBond` and escrows the premium in tokenIn. A reverted acceptance leaves neither. `FILLED_AQUA`, `FILLED_BOND`, and natural `EXPIRED` each pay the premium to the maker exactly once. A reverted execution attempt leaves the commitment `ACCEPTED`, the premium escrowed, and its bond locked for a later retry or expiry. Nonce cancellation after acceptance cannot cancel or modify the commitment.

`requiredBond` may exceed `minAmountOut`. For a 750 USDC lock and 700 USDC minimum, Bond settlement transfers exactly 700 USDC to the trader, consumes 700 USDC, unlocks the 50 USDC excess to maker availability, clears `lockedFor[commitment]`, and reduces maker total collateral and vault liabilities by exactly 700 USDC. Aqua and expiry unlock the complete lock without consumption.

On the Bond path Aqua is not called: its virtual tokenIn/tokenOut balances and underlying order remain unchanged. Trader tokenIn moves once to the maker, the vault pays tokenOut once, and the registry finalizes `FILLED_BOND`. The underlying Aqua order may remain reusable, but the terminal commitment cannot be executed again or spend any other commitment's lock.

### SwapVM program and native protections

The pinned opcode table leaves `0x52` free between standard `XYCConcentrateSwap` (`0x51`) and the next bank, and leaves `0x21` free immediately after standard `Deadline` (`0x20`). FirmDepth assigns `0x52` to `FIRM_PRICE` and `0x21` to `FIRM_GUARD`. The four program bytes `0x52 00 21 00` are therefore two instructions, each with zero static-argument bytes:

1. `FIRM_PRICE` consumes the first 32 runtime bytes, fixes `amountOut`, and in real execution proves it equals the accepted pricing snapshot.
2. `FIRM_GUARD` consumes the next 32 bytes as the commitment ID and binds status, expiry, exact-input mode, maker, executor, router, order hash, pair, amounts, and dedicated bond.

Static quote context computes the price while deliberately skipping commitment-state checks and transfers. Real context performs both checks before the pinned SwapVM native taker-trait validator and settlement. The executor-generated bytes independently bind native strict threshold to `minAmountOut` and native uint40 deadline to `expiry`; SDK and Solidity byte-level tests compare the complete encoding.

The Firm program contains no standard pricing opcode: Aqua push/pull settlement is selected by the pinned maker/taker traits around VM execution. Official Aqua keys strategy state by maker, app/router, order hash, and token. Its ship/dock authority is the maker and the Firm router is the app; the exact path has no KYC, resolver allowlist, or taker-access bypass. FirmDepth's custom router is consequently a valid Aqua app while its guard restricts real execution to the signed executor.

### Static analysis and artifact scope

Slither 0.11.6 fully analyzed the isolated FirmDepth-owned vault, registry, and pricing graph (30 contracts, 81 detectors) and separately analyzed the executor/guard boundary with a router interface harness (33 contracts, 81 detectors). Reported arbitrary-transfer, timestamp, strict-equality, unused-return, and balance-after-call warnings are intentional and covered by authorization, exact-delta, expiry-boundary, reentrancy, and rollback tests. Complete inherited-router analysis remains limited by Hardhat 3 AST identifier failures in the pinned Aqua/SwapVM graph; the inherited boundary is covered manually and dynamically. No actionable critical or high finding remains.

The benchmark commits deterministic source/config plus 81 aggregate rows for 810,000 seeded episodes, not 810,000 event records. Its raw JSON, raw CSV, frontier, and adversarial receipt total about 163 KB (roughly 20 KB packed for the two raw files), so retaining them is useful evidence rather than repository bloat. All benchmark claims are explicitly synthetic. Fork funding impersonates a historical Base USDC holder only inside the local deterministic fork; no public-mainnet transaction occurs.

## Sponsor integration and deployment scope

- Aqua source pinned at `9c5c42e5840e8741fba3597c48456c9510212b66`.
- SwapVM source pinned at `f09a41e689240adc645934f965c8061749397cd2`.
- `@1inch/aqua-sdk@0.3.2` and `@1inch/solidity-utils@6.9.10`.
- Solidity `0.8.30` with optimizer and IR compilation enabled.

The [official Aqua repository](https://github.com/1inch/aqua) lists deterministic deployments on production networks, not Sepolia. FirmDepth therefore keeps a pinned Base fork as its canonical sponsor-qualification proof and separately records its live Sepolia deployment against the compatible Aqua address authenticated in the public manifest.

The SDK production dependency audit is clean. The contract workspace inherits advisories through the pinned 1inch Solidity utility/tooling dependency graph; those packages are not linked into deployed bytecode, but remain an upstream tooling risk when processing untrusted input. Sponsor versions are intentionally pinned rather than upgraded solely to silence audit output.

## Public Sepolia demo runbook

The checked-in [`deployments/sepolia.json`](deployments/sepolia.json) is the only public deployment manifest. Its `ready` status, addresses, strategy hashes, and transaction lists are backed by real Sepolia receipts. Every command reads explicit shell variables and no package auto-loads `.env`.

First validate the configured compatible Aqua, canonical WETH, Circle USDC, maker funding, bytecode, metadata, zero-transfer behavior, and `rawBalances`, then generate parameters and deploy:

```bash
export SEPOLIA_RPC_URL='https://credential-bearing-rpc.example'
export SEPOLIA_DEPLOYER_PRIVATE_KEY='0x...'
export MAKER_PRIVATE_KEY='0x...'
export AQUA_ADDRESS='0x499943E74FB0cE105688beeE8Ef2ABec5D936d31'
export WETH_ADDRESS='0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
export USDC_ADDRESS='0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
export MAX_QUOTE_TTL=120

npm --prefix packages/contracts run testnet:check
npm --prefix packages/contracts run testnet:parameters
npm --prefix packages/contracts run deploy:sepolia
npm --prefix packages/contracts run testnet:record
npm --prefix packages/sdk run build
npm --prefix packages/contracts run testnet:setup
npm --prefix packages/contracts run testnet:verify
```

`testnet:setup` is explicit and idempotent. It verifies active strategies before changing anything, creates only missing Firm/Soft strategies, uses real Aqua `push` calls to replenish an active strategy, repairs required approvals/Bond, never docks a strategy, and never executes a trade. A previously docked immutable strategy stops setup with a concrete redeployment error. `testnet:reseed` invokes the same safe reconciliation.

Sepolia uses deliberately small public-testnet economics: 5 USDC of virtual output per strategy, 0.001 WETH suggested input, and 18 USDC of Bond. After the successful Soft swap and output-only reseed, the Soft XYC reserves are 0.001 WETH and 5 USDC. The unchanged curve therefore quotes exactly 2.5 USDC for another 0.001 WETH input, and the unchanged 120% policy requires exactly 3 USDC of Bond. Quote input bounds and the minimum premium are scaled down with the trade size. These are setup/manifest values only and do not alter Solidity or protocol semantics.

### 2026-09-13 incident chronology

| Nonce | Transaction | Result |
|---|---|---|
| 0 | [Wrap 0.003 ETH](https://sepolia.etherscan.io/tx/0xe5e15cd8b5236b2d4a7f54b018bc3101db4548364bb648493c1038dca13407c8) | Succeeded |
| 1 | [Approve Router for 0.001 WETH](https://sepolia.etherscan.io/tx/0x9f71db685f4185acfbadc239b436d6e624d459d1c53d46e3bec4cc1e2c2a54b1) | Succeeded; allowance only |
| 2 | [Approve Registry premium](https://sepolia.etherscan.io/tx/0x9c2e26b850cabd5902c594afc7f132f940fefa07da903a3a29302ac2fc3a06d4) | Succeeded; allowance only |
| 3 | [Firm acceptance](https://sepolia.etherscan.io/tx/0x3651c2e926747d48778db930e77667b753ad9b7c286d0b3a401f4d69cedd7237) | Reverted with `QuoteExpired(uint64)` after its 30-second quote expired |
| 4 | — | EIP-7702 authorization nonce embedded in nonce 3, not a transaction |
| 5 | [Soft swap](https://sepolia.etherscan.io/tx/0x91a644d50a4b3db682d0c3cc78191e8dd4248c72aa189990cac817ce5e9e4fa9) | Succeeded: 0.001 WETH to 5 USDC |

The Firm quote expired at `2026-09-13T01:12:30Z` and was mined at `01:12:48Z`. Commitment `0xc346…e5d4` remains `NONE` with zero timestamps, no Bond was locked, and its maker quote nonce was not consumed. The successful Soft swap is the public Soft-path evidence; do not execute it again during the recovery walkthrough. The Router's subsequent zero-output error is `TakerTraitsAmountOutMustBeGreaterThanZero(uint256)` (`0xf6ab88ca`), caused by depleted Soft output depth rather than a contract defect.

### Real manual Firm validation

The dynamic injected-wallet validation accepted commitment `0x864e…0695` in [transaction `0x1e85…5a74`](https://sepolia.etherscan.io/tx/0x1e8525be7106bf5ea7a0163bb17e1ad0a249fbbf975a126e9055cfdfcc5e5a74) at block `11694311` and executed it in [transaction `0x51af…dc42`](https://sepolia.etherscan.io/tx/0x51af9f91be8c755aa70283fbac35a2f1a8dd213bd445de89b47b5674d2e2dc42) at block `11694313`. Registry state and the SDK receipt both resolve to `FILLED_AQUA`. The receipt contains one SwapVM `Swapped`, Aqua `Pushed` 0.001 WETH and `Pulled` 2.5 USDC, one 2.5 USDC maker-to-taker transfer, one 3 USDC `BondUnlocked`, zero `BondReleased`, and the accepted premium moving from Registry to maker exactly once. Runtime traits bind `FIRM_PRICE` (`0x52`), `FIRM_GUARD` (`0x21`), the 2.5 USDC threshold, commitment ID, and expiry.

That fill reduced Firm virtual output to 2.5 USDC. The idempotent setup restored only the missing 2.5 USDC with one Aqua `Pushed` event in [transaction `0x7fe3…f1f`](https://sepolia.etherscan.io/tx/0x7fe385d457eb8f1173b2e972ab69efce01a002f96eccdbde80eaabee04762f1f) at block `11694351`. The full machine-readable receipt, transfer cardinalities, and post-reseed state are recorded in [`packages/contracts/evidence/sepolia-manual-firm.json`](packages/contracts/evidence/sepolia-manual-firm.json).

An execution attempted after an accepted commitment expires reverts with Executor `CommitmentExpired(uint64)` (`0x4a50a71e`). This is distinct from Registry `QuoteExpired(uint64)` during quote acceptance. The frontend directs the former to expiry settlement; neither expiry rule is relaxed.

Use the idempotent reseed with credentials entered without shell-history persistence. It pushes only the exact output delta missing from each active strategy, records every successful hash, preserves accumulated WETH input reserves, and recomputes the manifest revision:

```bash
read -rsp 'Sepolia RPC URL: ' SEPOLIA_RPC_URL; echo
read -rsp 'Maker private key: ' MAKER_PRIVATE_KEY; echo
export SEPOLIA_RPC_URL MAKER_PRIVATE_KEY
./scripts/reseed_sepolia.sh
unset SEPOLIA_RPC_URL MAKER_PRIVATE_KEY
```

Firm horizons of 5, 30, and 120 seconds are all supported. Use 120 seconds for the public Sepolia manual demo. The 5- and 30-second options are deliberately retained, but they are more sensitive to wallet-confirmation and block-inclusion latency.

After setup, `scripts/rehearse_sepolia_fork.sh` forks the current Sepolia state without modifying it, authenticates the recorded deployment/strategies, creates genuine 120-second maker signatures, and uses fork-only funded taker/drainer accounts to prove `FILLED_AQUA`, sibling-drain `FILLED_BOND`, natural `EXPIRED`, and SDK receipt reconstruction. Hardhat time and account controls are confined to this rehearsal and are never used by the public setup scripts.

Run the quote service locally with a private Azure-side RPC and a separate public browser RPC:

```bash
npm --prefix packages/quote-service ci
npm --prefix packages/quote-service run build
export PUBLIC_BROWSER_RPC_URL='https://public-origin-restricted-rpc.example'
export PUBLIC_API_URL='http://127.0.0.1:8080'
export CORS_ORIGINS='http://127.0.0.1:4173'
npm --prefix packages/quote-service start
```

Set `VITE_FIRMDEPTH_API_URL` to that API origin before building the frontend. When it is set, production loads only `GET /runtime` and compares it with the build-bundled Sepolia manifest before enabling live behavior. Without it, the ignored local Base-fork runtime remains available for the canonical regression suite.

The Azure scripts in [`infra/azure/`](infra/azure/) create a Linux B1 App Service, system identity, RBAC-enabled purge-protected Key Vault, Key Vault references, HTTPS-only service, and Application Insights settings. Run `az login` yourself, export the names in `.env.example`, then run `infra/azure/deploy.sh`. It checks `az webapp list-runtimes --os linux` before selecting Node. After Vercel preview and production URLs exist, set exact comma-separated origins and run `infra/azure/update-cors.sh`; production CORS must never be `*`.

Deploy Vercel from the repository root so its configuration builds both SDK and frontend. Set only `VITE_FIRMDEPTH_API_URL` in the frontend environment. Validate a preview manually before promoting that same revision to production.

Finally run the read-only readiness probe. It checks frontend/API availability, runtime/manifest equality, authenticated Sepolia relationships, strategy activity and pullable backing, maker Bond, and a real signed—but unaccepted—probe quote:

```bash
export PUBLIC_FRONTEND_URL='https://your-project.vercel.app'
export PUBLIC_API_URL='https://your-api.azurewebsites.net'
# Optional incident check only; the application never requires a fixed taker.
export READINESS_TAKER_ADDRESS='0x...'
./scripts/check_public_demo_readiness.sh
```

The only successful terminal output is `DEMO READY`; deficiencies are listed individually and the probe never submits a transaction. `READINESS_TAKER_ADDRESS` is optional and only adds a stale-`ACCEPTED` incident check; it is not a runtime or application dependency. The 120-second maker-signed probe validates positive live Soft output and the configured collateral ratio without hardcoding a taker or expected quote amount, and is never accepted.

With the rebuilt API on `127.0.0.1:8080` and frontend on `127.0.0.1:4173`, run `./scripts/test_frontend_sepolia_live.sh` for the read-only real-Sepolia browser smoke. It authenticates the runtime and deployed contracts, validates current Soft/Firm capacity and Bond, verifies a genuine maker-signed 120-second quote, and checks disconnected-wallet and responsive surfaces without injecting a fake taker or submitting a transaction.

For the manual browser retry, reject old wallet requests, hard-refresh the rebuilt frontend, and connect the designated taker on Sepolia. Inspect Soft and verify the live 0.001 WETH to 2.5 USDC quote without executing it. Then switch to Firm, keep 0.001 WETH and the recommended 120-second horizon, and click Accept. Confirm any Registry-premium and Executor-input approvals; the app discards quotes observed during approvals and validates a fresh signed quote before acceptance. Promptly confirm acceptance, wait for `ACCEPTED` and its explorer link, refresh to verify Registry recovery, then execute with the preapproved input. Confirm `FILLED_AQUA` and receipt reconstruction after another refresh. Finally reseed consumed Firm depth and require `DEMO READY` before beginning Azure deployment.

FirmDepth does not include Uniswap recovery, cross-chain behavior, undercollateralized credit, exotic ERC-20 support, or an independent production audit.

## Licensing

Powered by Aqua — © Degensoft Ltd 2025<br>
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth's SwapVM-linked contracts and instructions use `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper uses `LicenseRef-Degensoft-Aqua-Source-1.1`. Full license texts are in [`LICENSES/`](LICENSES/).

## Mumbai 2026: Protected Settlement

Protected Settlement extends pre-existing FirmDepth commitments into atomic treasury payouts. The payer funds an immutable plan; the settlement contract becomes the signed taker. Both Aqua execution and covered bond fallback can fund exact recipient allocations. A failed payout reverts the entire settlement. Expiry returns unspent WETH to the payer while preserving v1 premium economics.

See [architecture, assumptions and reproducible demonstration](docs/protected-settlement.md). Run `./scripts/demo_protected_settlement.sh` for the local Base-fork gates. The `/settlement` interface requires a generated settlement-enabled runtime. Existing public Sepolia deployment records are unchanged.

The Mumbai baseline is `89c4a7910f054042872927a29e162538f6fa7b65`. The new wrapper, settlement SDK/service integration, payout UI and transaction demonstrations are continuity additions. Aqua/SwapVM and FirmDepth's original collateral guarantees predate Mumbai.
