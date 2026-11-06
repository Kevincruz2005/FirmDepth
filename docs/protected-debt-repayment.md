# Protected debt repayment — Mumbai Continuity extension

This integration composes the existing Protected Settlement with Aave V3's established variable-debt repayment operation. It adds no new swap protocol or liquidation-prevention guarantee. The pre-repayment baseline is `2d823188e981ea44f97dd6421fe2c1638ea8d027`; the original Mumbai FirmDepth baseline remains `89c4a7910f054042872927a29e162538f6fa7b65`.

| Layer | Existing functionality and new scope |
|---|---|
| Original FirmDepth | Aqua/SwapVM, `FIRM_PRICE`, `FIRM_GUARD`, signed quotes, premium economics, commitment registry, executor, covered bond fallback and replay/expiry rules. |
| Protected Settlement | Immutable payer-owned payout allocations, isolated WETH escrow, contract taker, atomic transfers, surplus and expiry refunds. |
| Debt repayment addition | One immutable Aave repayment action around the unchanged wrapper, borrower authorization, capped USDC repayment, scaled debt verification, repayment receipts and a frontend mode. |

No original FirmDepth Solidity contract or `ProtectedSettlement.sol` is modified. The public Sepolia core and payout deployments are preserved.

## Verified compatibility

The canonical environment is a **local Base fork at block 51,123,118**, chain ID 8453. Transactions use actual forked Aave Pool, debt-token, USDC, WETH and Aqua contracts. These local hashes are not public explorer transactions.

| Contract | Address |
|---|---|
| Aave V3 Base Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Native Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Aave USDC variable-debt token | `0x59dca05b6c26dbd64b5381374aAaC5CD05644C28` |
| Aave aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |
| Base WETH | `0x4200000000000000000000000000000000000006` |

Addresses are sourced from the [Aave address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol) and independently checked against bytecode, Pool addresses-provider registration, reserve token configuration, debt-token Pool/underlying and decimals. [`aave-base-compatibility.json`](../deployments/aave-base-compatibility.json) records that check. The integration uses `repay(asset, amount, 2, borrower)` as documented by [Aave V3](https://aave.com/docs/aave-v3/smart-contracts/pool).

A read-only public-chain probe confirmed that FirmDepth's Sepolia USDC, `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, has no variable-debt token in the official Aave Sepolia Pool. Aave's configured test USDC is a different asset, `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8`. [`aave-sepolia-compatibility.json`](../deployments/aave-sepolia-compatibility.json) records actual observations. Tokens are never substituted. The existing Azure/Sepolia payout deployment does not acquire a claimed public Aave capability.

## Composition and authorization

`ProtectedDebtRepayment` pins exactly one wrapper, Pool, asset, variable-debt token, reserve aToken, addresses provider and data provider at deployment. It has no owner setter, arbitrary target/call data, delegatecall, collateral withdrawal or debt-delegation operation. The SDK and frontend additionally allow only the recorded Base market.

The original payer creates an immutable repayment plan specifying borrower, WETH input, premium budget, deadline, maximum USDC repayment and minimum acceptable repayment. Only variable debt mode 2 and the configured USDC asset are accepted. The authorization hash binds the chain, adapter, payer, borrower, Pool, asset, variable-debt token, mode, amounts, deadline and underlying plan ID. Acceptance permanently binds this authorization to the commitment digest.

The adapter creates a normal payout plan in `ProtectedSettlement` with one recipient: itself. The wrapper's plan payer is the adapter; the repayment plan's payer is the actual authorized wallet. **The maker signs the existing settlement wrapper as taker**, not the connected payer or the repayment adapter. The current `/quote/settlement` endpoint already handles these funded wrapper plans; no alternate quote economics or signatures are introduced.

```mermaid
sequenceDiagram
    participant P as Payer
    participant D as Repayment adapter
    participant S as Protected Settlement
    participant F as FirmDepth / Aqua / Bond
    participant A as Aave Pool
    P->>D: Create immutable borrower/amount/deadline plan
    D->>S: Create payout plan to adapter
    P->>D: Fund WETH input + premium budget
    D->>S: Fund existing isolated escrow
    P->>D: Accept maker quote signed for S
    D->>S: Accept and bind commitment
    S->>F: Escrow premium, lock bond
    Note over P,A: Acceptance and execution are separate transactions
    P->>D: Execute authorized plan
    D->>S: Execute existing settlement
    S->>F: Aqua execution or covered bond path
    F-->>S: USDC output
    S-->>D: Payout, surplus and unused WETH budget
    D->>A: Approve capped amount; repay(USDC, amount, 2, borrower)
    A-->>D: Actual amount repaid
    D->>D: Verify reserve cash and nominal/scaled debt reduction
    D-->>P: Remaining USDC + unused WETH budget
    Note over D,A: Any failure reverts the complete execution transaction
```

## Repayment and accounting rules

The approved amount is `min(current variable debt, authorized repayment cap)`. It must satisfy the immutable minimum. The adapter verifies the Pool's returned repayment, its exact USDC debit, the reserve aToken's exact USDC credit, the borrower's nominal debt reduction and a strictly smaller scaled debt balance. It then clears the Pool approval. Token allowance is bounded rather than unlimited.

Aave stores integer scaled debt units. The adapter verifies that the scaled burn lies between the floor and ceiling of `actualRepaid × 1e27 / normalizedDebtIndex`. The nominal rounding bound is derived from the same index: `ceil(index / 1e27)` USDC base units. A fixed one-unit allowance is insufficient for every accrued index. Receipts include the observed index and independently verify this relationship.

If debt shrinks, the authorized cap remains unchanged but only the permitted actual repayment is spent; excess USDC returns to the payer. Debt growth does not increase the cap. Zero debt or repayment below the minimum reverts execution. Partial repayment is acceptable only within the immutable minimum and cap. A full close can still be affected by later interest, borrowing or liquidation.

Funding passes through the adapter into the existing wrapper escrow with exact debit/credit checks and a temporary exact allowance. The adapter holds no persistent plan escrow. Every execution measures token balance increases from that specific wrapper call; existing donations are neither credited nor sweepable. Both success and refund restore the adapter's prior balances. The wrapper's existing plan ledger provides isolation between funded commitments.

Only the original repayment payer can fund, accept, execute or refund. The borrower may be another address because Aave permits repayment on behalf of a third party; no borrower collateral or borrowing power is accessed. Terminal wrapper state prevents duplicate repayment and refunds. Plan IDs separate chain, wrapper, adapter, payer and nonce.

## Failure and expiry safety

Repayment runs inside the same transaction as wrapper execution. A Pool revert, reserve mismatch, unexpected token behavior, incorrect debt reduction, repayment below the minimum, or later refund failure reverts the swap, downstream transfers, Aave debt changes, premium finalization and bond release. An unrelated Aave failure cannot select or consume FirmDepth's bond path.

Before acceptance, the payer can cancel and recover all funded WETH. After the signed commitment expires, the payer can recover unspent principal and unused premium budget. Accepted premium remains payable to the maker, exactly as in v1. Direct v1 expiry finalization remains supported. The refund path does not call Aave; reserve pause or configuration changes cannot prevent it. UI identity checks are deliberately separate from live Aave availability for this reason.

The Pool and token proxies remain governed by their protocols. Reserve pause, token freezes, governance upgrades, changing debt, inadequate inventory at acceptance and signed deadlines can prevent execution. These dependencies are not covered by an unconditional repayment or liquidation-prevention promise. Only exact-transfer canonical WETH/USDC semantics are supported.

## Reproduce the complete demonstration

Requirements: Node 22+, npm, Bash, Chrome (or `PLAYWRIGHT_CHROME_PATH`), free ports 8545/4174, and a Base archive endpoint supporting block 51,123,118. Keep RPC credentials in the ignored `.env`, not command arguments or committed artifacts. The runner uses the already-recorded historical USDC holder for fork-only funding and avoids remote holder-log scans.

```bash
# From the repository root, explicitly load local configuration if needed.
set -a
source .env
set +a

KEEP_LOCAL_FORK=1 ./scripts/demo_protected_debt.sh
```

The runner builds/tests the contracts, SDK, service and frontend, runs benchmark tests, starts a fresh pinned fork, executes the original browser regressions, payout browser cases and Aave browser cases, then deploys the real debt fixture and independently verifies the final demonstration. The named `debtFork` configuration reads `BASE_RPC_URL` from the environment, keeping private URLs out of process arguments and matching the existing CLI node's wall-clock start. The separate historical `baseFork` profile is unchanged. Public archive endpoints can rate-limit; use a reliable `BASE_RPC_URL` for repeatable cold starts.

The setup supplies real WETH collateral and borrows 600 USDC through Aave. Repeated browser fixtures close previous test debt through real `Pool.repay` using previously borrowed USDC, plus a real one-USDC maker transfer covering accrued interest, before opening a fresh position. No Aave debt, oracle, implementation code or token balance storage is fabricated.

The recorded demonstration:

1. Accepts and executes a normal Aqua-backed 200-USDC repayment.
2. Accepts another commitment, ships a real overlapping Aqua sibling sized to the current inventory, executes its liquidity drain, and repays 200 USDC from the covered bond.
3. Restores maker inventory with an actual transfer, authorizes a 300-USDC cap, closes the smaller remaining debt and returns the surplus.
4. Borrows again, accepts a plan, advances local fork time past expiry and verifies the WETH refund without debt repayment.
5. Temporarily impersonates the real USDC blacklister on the local fork to block only the payer's final surplus refund. The mined execution fails after reaching `Pool.repay`; debt, reserve cash, escrow and bond remain unchanged. The blacklist is removed and the same accepted plan succeeds once on retry.

The blacklist intervention is an explicitly injected **local-fork failure condition**. Pool, debt-token and USDC bytecode remain unchanged. `verify-debt-fork.ts` checks the failed receipt, historical state and EVM trace proving the real Pool call was reached. It also reconstructs successful SDK receipts, verifies actual ERC-20 transfers and debt changes, and checks expiry and liabilities.

Actual local addresses, hashes and balances are in [`protected-debt-base-fork.json`](../deployments/protected-debt-base-fork.json) and the [transaction evidence](../packages/contracts/evidence/protected-debt-base-fork.json). Verify a retained node independently:

```bash
cd packages/contracts
npx hardhat run scripts/verify-debt-fork.ts --network localBase
```

With `KEEP_LOCAL_FORK=1`, the runner creates a fresh interactive deployment and a real 600-USDC debt position after the recorded demonstration. The manifest's `addresses` and `transactions` describe the completed proof; its separate `interactive` section records the fresh adapter, wrapper, borrow receipt and observed debt used by the current frontend. The verifier checks both and verifies proof balances at their original transaction blocks. Restarting the node invalidates these local receipts; rerun the demonstration to replace them.

For an interactive application, retain the node, unset the public API build setting and start the local development frontend:

```bash
unset VITE_FIRMDEPTH_API_URL
npm --prefix packages/frontend run dev
```

Open `http://127.0.0.1:4173/settlement` and choose **Debt Repayment**. Configure the test wallet's RPC as `http://127.0.0.1:8545` with chain 8453, using the controlled fork trader account. Base mainnet shares this chain ID: the repayment UI additionally confirms the wallet RPC has the same adapter bytecode and local block hash before submitting a transaction. Do not use real production keys in the unlocked development wallet. The existing **Payout** mode remains available.

The UI displays verified borrower debt, fixed repayment limits, WETH input, premium budget and paid premium, signed USDC minimum, commitment expiry, lifecycle state, actual repayment, before/after debt and independently verified transaction evidence. Every Aave value is labelled local-fork evidence. No public Base or Sepolia repayment is claimed.

The controlled local quote middleware uses a fixed 2,000-USDC/WETH test price and genuine maker signatures. It is a reproducible fixture, not a live market-price oracle or a production maker service. The official Aqua and SwapVM contracts execute real ERC-20 transfers on the ordinary path and the sibling drain; the covered path uses FirmDepth's unchanged locked bond settlement.

## Validation

The clean-fork run passed these gates without changing or weakening existing tests:

| Suite | Passed |
|---|---:|
| Solidity: original FirmDepth, Protected Settlement and repayment | 121 |
| SDK | 39 |
| Quote service | 12 |
| Frontend unit tests | 33 |
| Benchmark regressions | 8 |
| Original browser regressions | 25 |
| Existing payout browser scenarios | 3 |
| Real Aave browser scenarios | 5 |

SDK, quote-service and frontend builds pass. Frontend lint has zero errors and one existing payout-effect dependency warning. Public Sepolia/Azure browser suites are separately gated and are not counted as local Aave evidence. Unit repayment tests deliberately use adversarial mocks; the fork demonstration and browser repayment scenarios use actual Aave and ERC-20 contracts.
