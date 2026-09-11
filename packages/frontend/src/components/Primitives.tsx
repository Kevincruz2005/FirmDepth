import { ArrowUpRight, Check, CircleAlert, LoaderCircle, Radio } from "lucide-react";
import type { ReactNode } from "react";
import type { Provenance } from "../data/evidence";
import { shortHex } from "../lib/format";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function TruthTag({ value }: { value: Provenance }) {
  return <span className={`truth-tag truth-${value.toLowerCase().replaceAll(" ", "-")}`}><span aria-hidden="true" />{value}</span>;
}

export function StatusDot({ tone = "neutral", children }: { tone?: "good" | "bad" | "live" | "neutral"; children: ReactNode }) {
  const Icon = tone === "good" ? Check : tone === "bad" ? CircleAlert : tone === "live" ? Radio : LoaderCircle;
  return <span className={`status-dot status-${tone}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}

export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function HashLink({ value, label }: { value: string; label?: string }) {
  return <span className="hash-value" title={value}>{label ?? shortHex(value)} <ArrowUpRight size={12} aria-hidden="true" /></span>;
}

export function SectionIntro({ number, eyebrow, title, copy }: { number: string; eyebrow: string; title: string; copy: string }) {
  return <header className="section-intro"><div className="section-number">{number}</div><div><Eyebrow>{eyebrow}</Eyebrow><h2>{title}</h2><p>{copy}</p></div></header>;
}
