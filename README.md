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

## Verify in three minutes

Requirements: Node.js 22+, npm, Bash, and network access to Base RPC. An optional `BASE_RPC_URL` can override the public endpoint.

```bash
npm --prefix packages/contracts ci
npm --prefix packages/sdk ci
./scripts/demo_backend.sh
```

The release gate compiles the contracts, runs all unit/fuzz tests, builds and tests the SDK, verifies the official sponsor contracts at pinned Base block `51,123,118`, executes the adversarial fork demo, then regenerates and validates the deterministic benchmark.

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

## Verified backend

- 58 Solidity tests pass, including two vault/accounting invariants at 1,024 fuzz runs each.
- 21 TypeScript SDK tests pass after a clean build.
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

The [official Aqua repository](https://github.com/1inch/aqua) lists deterministic deployments on production networks, not Sepolia. FirmDepth therefore uses a pinned Base fork as its canonical sponsor-qualification proof. The included Sepolia scripts require the operator to supply and validate a compatible Aqua deployment plus funded credentials; no public-testnet deployment is claimed by this repository.

The SDK production dependency audit is clean. The contract workspace inherits advisories through the pinned 1inch Solidity utility/tooling dependency graph; those packages are not linked into deployed bytecode, but remain an upstream tooling risk when processing untrusted input. Sponsor versions are intentionally pinned rather than upgraded solely to silence audit output.

FirmDepth does not include Uniswap recovery, cross-chain behavior, undercollateralized credit, exotic ERC-20 support, or an independent production audit.

## Licensing

Powered by Aqua — © Degensoft Ltd 2025<br>
Powered by SwapVM — © Degensoft Ltd 2025

FirmDepth's SwapVM-linked contracts and instructions use `LicenseRef-Degensoft-SwapVM-1.1`; the unmodified Aqua deployment wrapper uses `LicenseRef-Degensoft-Aqua-Source-1.1`. Full license texts are in [`LICENSES/`](LICENSES/).
