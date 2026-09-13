import { ExternalLink, Wallet, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { InjectedWalletSummary } from "../lib/injected-wallets";

interface Props {
  open: boolean;
  providers: InjectedWalletSummary[];
  discoverySettled: boolean;
  connecting: boolean;
  error: string | null;
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

export function WalletChooser({ open, providers, discoverySettled, connecting, error, onSelect, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  return <div className="wallet-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title">
      <header><div><span>Injected EVM wallet</span><h2 id="wallet-dialog-title">Choose wallet</h2></div><button ref={closeButton} type="button" aria-label="Close wallet chooser" onClick={onClose}><X size={18} /></button></header>
      {providers.length > 0 ? <><p>Only wallets detected in this browser are shown.</p><div className="wallet-options">{providers.map((provider) => <button key={provider.id} type="button" onClick={() => onSelect(provider.id)} disabled={connecting}>
        {provider.icon ? <img src={provider.icon} alt="" /> : <span className="wallet-option-icon"><Wallet size={18} /></span>}
        <span><strong>{provider.name}</strong><small>{provider.legacy ? "Legacy injected provider" : provider.rdns}</small></span>
      </button>)}</div></> : discoverySettled ? <div className="no-wallet-state"><span className="wallet-empty-icon"><Wallet size={22} /></span><h3>No browser wallet detected.</h3><p>Install an EVM-compatible wallet to use FirmDepth. Read-only Trade, Evidence, Maker, and Docs remain available.</p><div><a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Install MetaMask <ExternalLink size={14} /></a><a href="https://rabby.io/" target="_blank" rel="noopener noreferrer">Install Rabby <ExternalLink size={14} /></a></div></div> : <p className="wallet-discovery-state" role="status">Looking for installed wallets…</p>}
      {error && <p className="wallet-dialog-error" role="alert">{error}</p>}
    </section>
  </div>;
}
