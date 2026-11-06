import { ChevronDown, Github, Menu, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRuntime, useWallet } from "../hooks/useRuntime";
import { shortHex } from "../lib/format";
import { StatusDot } from "./Primitives";
import { WalletChooser } from "./WalletChooser";

const routes = [
  ["/trade", "Trade"],
  ["/settlement", "Settle"],
  ["/evidence", "Evidence"],
  ["/maker", "Maker"],
  ["/docs", "Docs"],
] as const;

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const { runtime, loading, error } = useRuntime();
  const wallet = useWallet();
  const dismissWalletChooser = wallet.closeWalletChooser;
  const closeWalletChooser = useCallback(() => {
    dismissWalletChooser();
    window.setTimeout(() => connectButton.current?.focus(), 0);
  }, [dismissWalletChooser]);
  useEffect(() => setOpen(false), [route]);
  useEffect(() => setAccountOpen(false), [route, wallet.account, wallet.chainId]);
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLAnchorElement>("#site-nav a")?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return <>
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="FirmDepth home"><span>F</span>FirmDepth</a>
      <button ref={menuButton} className="menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="site-nav" aria-label="Toggle navigation">{open ? <X /> : <Menu />}</button>
      <nav id="site-nav" className={open ? "open" : ""} aria-label="Primary navigation">
        {routes.map(([href, label]) => <a key={href} href={href} aria-current={route === href ? "page" : undefined}>{label}</a>)}
      </nav>
      <div className="header-actions">
        {wallet.account === null ? <button ref={connectButton} className="button button-dark button-small wallet-connect" type="button" onClick={wallet.openWalletChooser} disabled={wallet.connecting}><Wallet size={15} />{wallet.connecting ? "Connecting…" : "Connect wallet"}</button> : <div className="account-control">
          <button className="account-summary" type="button" aria-expanded={accountOpen} aria-controls="account-menu" onClick={() => setAccountOpen((value) => !value)}><span>{wallet.chainId === runtime?.artifact.chainId ? runtime.artifact.chainId === 11155111 ? "Sepolia" : runtime.artifact.environment.label : `Chain ${wallet.chainId ?? "…"}`}</span><strong>{shortHex(wallet.account, 6, 4)}</strong><ChevronDown size={14} /></button>
          {accountOpen && <div id="account-menu" className="account-menu">
            <span>Connected account</span><code>{wallet.account}</code>
            {loading ? <StatusDot>Runtime check</StatusDot> : runtime && wallet.chainId === runtime.artifact.chainId ? <StatusDot tone="live">{runtime.artifact.environment.label}</StatusDot> : error ? <StatusDot tone="bad">Runtime mismatch</StatusDot> : <StatusDot tone="bad">Wrong network</StatusDot>}
            {wallet.chainId !== runtime?.artifact.chainId && wallet.selectedProviderId && <button type="button" onClick={() => void wallet.connectProvider(wallet.selectedProviderId!)}>Switch to Sepolia</button>}
            <button type="button" onClick={wallet.disconnect}>Disconnect</button>
          </div>}
        </div>}
      </div>
    </header>
    <WalletChooser open={wallet.chooserOpen} providers={wallet.providers} discoverySettled={wallet.discoverySettled} connecting={wallet.connecting} error={wallet.error} onSelect={(providerId) => void wallet.connectProvider(providerId)} onClose={closeWalletChooser} />
    <main id="main-content" tabIndex={-1}>{children}</main>
    <footer className="site-footer">
      <div><a className="wordmark" href="/"><span>F</span>FirmDepth</a><p>Bond-backed execution certainty for reusable Aqua liquidity.</p></div>
      <div className="footer-links"><a href="/trade">Trade</a><a href="/evidence">Evidence</a><a href="/maker">Maker</a><a href="/docs">Docs</a><a href="https://github.com/1inch/aqua" target="_blank" rel="noreferrer"><Github size={15} /> Aqua</a></div>
      <p className="footer-meta">Exact-input WETH → USDC · Pricing v2 · Base-fork evidence</p>
    </footer>
  </>;
}
