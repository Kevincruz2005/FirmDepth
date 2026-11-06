# FirmDepth core architecture

FirmDepth adds collateral-backed commitments to Aqua's reusable inventory. These mechanisms predate the Mumbai payout and Aave repayment extensions. The original baseline is `89c4a7910f054042872927a29e162538f6fa7b65`.

## Components

| Component | Responsibility |
|---|---|
| [FirmAquaSwapVMRouter](../packages/contracts/contracts/FirmAquaSwapVMRouter.sol) | Extends the pinned SwapVM router with commitment-bound pricing and guard instructions. |
| [FirmCommitmentRegistry](../packages/contracts/contracts/FirmCommitmentRegistry.sol) | Verifies EIP-712/ERC-1271 quotes, prevents replay, escrows premiums and owns commitment state. |
| [BondVault](../packages/contracts/contracts/BondVault.sol) | Tracks available/locked USDC collateral and commitment-specific locks. |
| [FirmExecutor](../packages/contracts/contracts/FirmExecutor.sol) | Classifies eligible capacity loss, executes exactly one settlement path and finalizes the commitment. |
| [SDK receipt verifier](../packages/sdk/src/receipt.ts) | Reconciles state, accepted parameters, SwapVM/bond events and ERC-20 transfers. |

Protected Settlement composes these contracts into immutable payouts. Protected Debt Repayment composes that wrapper into a fixed Aave action. Neither extension changes the original core contracts.

## Depth terminology

- **Virtual Depth:** the output balance advertised by a particular Aqua strategy.
- **Pullable Depth:** active `min(virtual balance, maker inventory, maker allowance to Aqua)`.
- **Firm Depth for a new quote:** `min(Pullable Depth, floor(available Bond × minAmountOut / requiredBond))`.

Firm Depth is quote-scoped because the bond can exceed promised output. Admission requires executable Aqua capacity and sufficient collateral. After acceptance, a covered capacity loss can use the dedicated lock even when current pullable inventory has fallen.

## Quotes and acceptance

The 22-field quote binds the chain and verifying registry, maker, taker, executor, router, order, token pair, input, output minimum, expiry, nonce, required bond and pricing snapshot. Signatures support EOAs and ERC-1271 makers.

Pricing version 2 uses unsigned integer fixed-point arithmetic. Conversion of the output-equivalent premium into tokenIn rounds up. The signed pricing horizon fixes the premium economics: later mining delay or utilization cannot reprice an accepted commitment. The [cross-language golden vector](../packages/sdk/test/firm-quote-golden.json) checks the signature/pricing boundary.

Acceptance requires an active strategy, sufficient virtual output, maker inventory, allowance, static quoted output and free collateral. It atomically locks `requiredBond` and escrows the tokenIn premium. Failed acceptance leaves neither a partial lock nor a consumed quote. Cancelling a maker nonce after acceptance cannot cancel the resulting commitment.

For the downstream wrappers, the signed taker is Protected Settlement. The original payer authorizes an immutable plan; its identity is distinct from the contract that takes the Firm quote.

## Execution and the covered boundary

Immediately before selecting a path, the executor verifies the accepted order and reads the exact maker/router/order-hash strategy's token counts, virtual output, maker output balance and allowance to Aqua. It compares effective capacity with the signed minimum.

| Observation | Result |
|---|---|
| Capacity remains sufficient | Execute through official Aqua and the modified SwapVM router. |
| Defined output-capacity shortage after acceptance | Settle through the commitment's dedicated bond. |
| Strategy becomes inactive after valid acceptance | Settle through the same covered bond obligation. |
| Read failure or unrelated execution error | Revert; do not select or consume bond collateral. |

An inactive strategy cannot be accepted initially. Post-acceptance maker docking is separately classified from sibling inventory depletion, but preserves the same already accepted economic obligation.

There is no external state-changing call between the capacity snapshot and input pull. The executor is non-reentrant, maker hooks are forbidden, and runtime taker traits prohibit callbacks. The Aqua swap is deliberately uncaught: token, router, instruction, threshold, deadline, panic or unknown failures revert the complete execution.

## Premiums, collateral and terminal state

`FILLED_AQUA`, `FILLED_BOND` and natural `EXPIRED` each pay the accepted premium to the maker once. An execution revert leaves the commitment accepted, premium escrowed and bond locked for retry or expiry.

On Aqua settlement, the full lock becomes available again. On bond settlement, the trader's input goes to the maker and exactly `minAmountOut` is paid from that lock. Any excess collateral is unlocked. For example, a 750-USDC lock covering 700 USDC pays 700, returns 50 to maker availability and reduces vault liabilities by 700.

The bond branch does not call Aqua or modify its strategy balances. Terminal state prevents a commitment from taking both paths, paying twice or spending another commitment's lock.

The original expiry boundaries remain distinct: `QuoteExpired(uint64)` rejects late acceptance, while `CommitmentExpired(uint64)` rejects late execution. Expiry finalization and owner refunds follow the existing registry/wrapper rules.

## SwapVM instructions

The pinned opcode table leaves `0x52` and `0x21` available. FirmDepth uses the program `0x52002100`: two instructions with zero static argument bytes.

1. **FIRM_PRICE (`0x52`):** consumes 32 runtime bytes, fixes output and checks it against accepted pricing during execution.
2. **FIRM_GUARD (`0x21`):** consumes the next 32 bytes as commitment ID and checks status, expiry, exact-input mode, identities, order, assets, amounts and dedicated collateral.

Static quoting computes price without requiring a funded commitment. Execution performs the guard checks and the pinned SwapVM native taker-trait validation. Native strict output threshold and uint40 deadline independently bind the signed minimum and expiry; SDK/Solidity tests compare the byte encoding.

Aqua keys strategy state by maker, app/router, order hash and token. The maker controls ship/dock authority; FirmDepth's router is the Aqua app. Official push/pull transfers remain part of ordinary settlement. The covered branch is a narrowly defined alternative for an already accepted obligation.

## Evidence and analysis scope

The [canonical original fork evidence](../packages/contracts/evidence/base-fork-demo.json) records transactions and token/accounting reconciliation. [Benchmark artifacts](../packages/benchmark/) model 810,000 seeded episodes across 81 configurations. Those are synthetic stress results, not real-network failure rates.

Earlier Slither analysis covered the owned vault/registry/pricing graph and an executor/guard interface harness. Full inherited Aqua/SwapVM analysis was limited by Hardhat 3 AST identifier issues. Do not treat that earlier scope as an independent audit of the payout or repayment extensions.

Exact-transfer WETH/USDC semantics are required. Fee-on-transfer/rebasing assets, arbitrary token behavior and unrelated execution failures are not converted into an obligation to spend the bond. Infrastructure and protocol dependencies still matter; there is no blanket settlement or liquidation-prevention guarantee.

See [Protected Settlement](protected-settlement.md), [Aave repayment](protected-debt-repayment.md), [local user flow](local-user-flow.md) and [deployment evidence](../deployments/) for the composed application behavior.
