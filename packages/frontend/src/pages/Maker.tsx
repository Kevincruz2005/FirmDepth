import { approveToken, depositBond, withdrawBond } from "@firmdepth/sdk/actions";
import { sharedLiquidityRatioWad } from "@firmdepth/sdk/capacity";
import { getLiquidityReality, readMakerBond, type LiquidityReality } from "@firmdepth/sdk/readers";
import type { MakerBondState } from "@firmdepth/sdk/types";
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { Eyebrow, Metric, StatusDot, TruthTag } from "../components/Primitives";
import { benchmarkEvidence } from "../data/evidence";
import { useRuntime, useWallet } from "../hooks/useRuntime";
import { formatPercent, formatToken, shortHex } from "../lib/format";
import { deserializeOrder } from "../lib/runtime";

export function Maker() {
  const { runtime } = useRuntime();
  const wallet = useWallet();
  const [bond, setBond] = useState<MakerBondState | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityReality | null>(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const strategy = useMemo(() => runtime?.artifact.strategies.find((value) => value.kind === "FIRM") ?? null, [runtime]);
  const maker = strategy?.order.maker ?? null;

  const inspect = useCallback(async () => {
    if (runtime === null || strategy === null || maker === null) return;
    try {
      const order = deserializeOrder(strategy.order);
      const [nextBond, nextLiquidity] = await Promise.all([
        readMakerBond(runtime.publicClient, runtime.artifact.addresses.bondVault, maker),
        getLiquidityReality(runtime.publicClient, { aqua: runtime.artifact.addresses.aqua, router: runtime.artifact.addresses.firmRouter, maker, orderHash: strategy.orderHash, tokenIn: runtime.artifact.addresses.weth, tokenOut: runtime.artifact.addresses.usdc }),
      ]);
      setBond(nextBond); setLiquidity(nextLiquidity);
      void order;
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Maker state read failed"); }
  }, [maker, runtime, strategy]);

  useEffect(() => { void inspect(); }, [inspect]);

  async function mutate(kind: "deposit" | "withdraw") {
    if (runtime === null || wallet.account === null || wallet.walletClient === null || maker === null) return;
    if (wallet.account.toLowerCase() !== maker.toLowerCase()) return setMessage(`Connect the configured maker ${shortHex(maker)}`);
    setBusy(true); setMessage(null);
    try {
      const value = parseUnits(amount, 6);
      if (value <= 0n) throw new Error("Amount must be greater than zero");
      const clients = { publicClient: runtime.publicClient, walletClient: wallet.walletClient, account: wallet.account };
      if (kind === "deposit") {
        const approval = await approveToken(clients, runtime.artifact.addresses.usdc, runtime.artifact.addresses.bondVault, value);
        await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
        const hash = await depositBond(clients, runtime.artifact.addresses.bondVault, value);
        await runtime.publicClient.waitForTransactionReceipt({ hash });
      } else {
        const hash = await withdrawBond(clients, runtime.artifact.addresses.bondVault, value, wallet.account);
        await runtime.publicClient.waitForTransactionReceipt({ hash });
      }
      await inspect(); setMessage(`${kind === "deposit" ? "Deposit" : "Withdrawal"} confirmed`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Maker transaction failed"); }
    finally { setBusy(false); }
  }

  return <div className="app-page maker-page">
    <header className="page-title"><div><Eyebrow>Maker console</Eyebrow><h1>Make certainty a priced resource.</h1><p>Track reusable strategy capacity beside available and locked performance collateral. Bond is reserved per accepted commitment—not per advertised quote.</p></div><TruthTag value={runtime ? "LIVE" : "ILLUSTRATIVE"} /></header>

    <section className="maker-overview">
      <div className="maker-identity"><span className="maker-avatar">M</span><div><small>Configured maker</small><strong>{maker ? shortHex(maker, 10, 8) : "Runtime unavailable"}</strong><StatusDot tone={runtime ? "live" : "neutral"}>{runtime ? "Observed on fork" : "Evidence mode"}</StatusDot></div><button className="icon-button" onClick={() => void inspect()} disabled={runtime === null}><RefreshCw size={17} /></button></div>
      <div className="maker-metrics"><Metric label="Virtual strategy depth" value={liquidity ? `${formatToken(liquidity.virtualDepth, 6, 2)} USDC` : "—"} /><Metric label="Strategy SLR" value={liquidity && liquidity.realBalance > 0n ? `${formatToken(sharedLiquidityRatioWad(liquidity.virtualDepth, liquidity.realBalance), 18, 2)}×` : "—"} detail="virtual / real inventory" /><Metric label="Bond available" value={bond ? `${formatToken(bond.available, 6, 2)} USDC` : "—"} /><Metric label="Bond locked" value={bond ? `${formatToken(bond.locked, 6, 2)} USDC` : "—"} /></div>
    </section>

    <div className="maker-layout">
      <section className="bond-manager"><div className="panel-head"><div><Eyebrow>Performance collateral</Eyebrow><h2>Bond vault</h2></div><span>USDC</span></div><div className="vault-total"><span>Total maker collateral</span><strong>{bond ? formatToken(bond.total, 6, 2) : "—"} <small>USDC</small></strong><div><i style={{ width: bond && bond.total > 0n ? `${Number((bond.locked * 10000n) / bond.total) / 100}%` : "0%" }} /></div><small>{bond && bond.total > 0n ? `${formatPercent(Number(bond.locked) / Number(bond.total), 2)} currently locked` : "No live locks observed"}</small></div><label className="amount-input">Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>USDC</span></label>{wallet.account === null ? <button className="button button-dark button-wide" onClick={() => void wallet.connect()} disabled={runtime === null || wallet.connecting}><Wallet size={16} />Connect maker wallet</button> : <div className="bond-actions"><button className="button button-primary" onClick={() => void mutate("deposit")} disabled={busy}><ArrowDownToLine size={16} />Deposit</button><button className="button button-outline" onClick={() => void mutate("withdraw")} disabled={busy}><ArrowUpFromLine size={16} />Withdraw</button></div>}{(wallet.error || message) && <p className={message?.includes("confirmed") ? "inline-success" : "inline-error"}>{message?.includes("confirmed") ? null : <CircleAlert size={15} />}{wallet.error || message}</p>}<p className="manager-note">Deposits require a simulated USDC approval and vault transaction. Withdrawals can use only currently available collateral.</p></section>

      <section className="capital-research"><div className="panel-head"><div><Eyebrow>Capacity research</Eyebrow><h2>Capital reuse</h2></div><TruthTag value="SYNTHETIC BENCHMARK" /></div><div className="reuse-visual"><div className="reuse-row"><span>Soft Aqua</span><i><b style={{ width: "88.65%" }} /></i><strong>88.65%</strong></div><div className="reuse-row"><span>Hard reserved</span><i><b style={{ width: "66.86%" }} /></i><strong>66.86%</strong></div><div className="reuse-row firm"><span>FirmDepth</span><i><b style={{ width: "88.65%" }} /></i><strong>88.65%</strong></div></div><div className="research-callout"><span>10,000 / 10,000</span><p>admitted Firm commitments protected in the selected stress configuration</p></div><dl className="technical-list"><div><dt>Quote / inventory</dt><dd>40%</dd></div><div><dt>TTL</dt><dd>{benchmarkEvidence.adversarial.ttl}s</dd></div><div><dt>Shared liquidity ratio</dt><dd>{benchmarkEvidence.adversarial.sharedLiquidityRatio}×</dd></div><div><dt>Bond utilization</dt><dd>25%</dd></div></dl><p className="manager-note">Synthetic mechanism evidence only. No yield, return, or real-network frequency is inferred.</p></section>
    </div>

    <section className="maker-lifecycle"><div><span>01</span><h3>Deposit</h3><p>Maker supplies USDC performance collateral to the vault.</p></div><div><span>02</span><h3>Quote</h3><p>Pricing v2 signs utilization, TTL, minimum, premium, and bond.</p></div><div><span>03</span><h3>Accept</h3><p>Premium is escrowed and one commitment-specific lock is created.</p></div><div><span>04</span><h3>Settle</h3><p>Premium pays once; bond unlocks on Aqua or expires, or pays on Bond.</p></div></section>
  </div>;
}
