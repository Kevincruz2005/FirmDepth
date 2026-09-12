import { ArrowRight, Github, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRuntime } from "../hooks/useRuntime";
import { StatusDot } from "./Primitives";

const routes = [
  ["/trade", "Trade"],
  ["/evidence", "Evidence"],
  ["/maker", "Maker"],
] as const;

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { runtime, loading, error } = useRuntime();
  useEffect(() => setOpen(false), [route]);
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
        {loading ? <StatusDot>Runtime check</StatusDot> : runtime ? <StatusDot tone="live">{runtime.artifact.environment.label}</StatusDot> : error ? <StatusDot tone="bad">Runtime mismatch</StatusDot> : <StatusDot>Evidence mode</StatusDot>}
        <a className="button button-dark button-small" href="/trade">Open app <ArrowRight size={15} /></a>
      </div>
    </header>
    <main id="main-content" tabIndex={-1}>{children}</main>
    <footer className="site-footer">
      <div><a className="wordmark" href="/"><span>F</span>FirmDepth</a><p>Bond-backed execution certainty for reusable Aqua liquidity.</p></div>
      <div className="footer-links"><a href="/trade">Trade</a><a href="/evidence">Evidence</a><a href="/maker">Maker</a><a href="https://github.com/1inch/aqua" target="_blank" rel="noreferrer"><Github size={15} /> Aqua</a></div>
      <p className="footer-meta">Exact-input WETH → USDC · Pricing v2 · Base-fork evidence</p>
    </footer>
  </>;
}
