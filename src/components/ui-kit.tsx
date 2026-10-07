import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { NATURE_LABEL, type Nature } from "@/lib/case-data";
import { createClient } from "@/lib/supabase/client";

const natureCls: Record<Nature, string> = {
  observed: "border-observed/40 bg-observed/10 text-observed",
  reported: "border-reported/40 bg-reported/10 text-reported",
  derived: "border-derived/40 bg-derived/10 text-derived",
  inferred: "border-dashed border-inferred/50 bg-inferred/10 text-inferred",
  disputed: "border-disputed/50 bg-disputed/10 text-disputed",
};

export const natureFill: Record<Nature, string> = {
  observed: "var(--observed)",
  reported: "var(--reported)",
  derived: "var(--derived)",
  inferred: "var(--inferred)",
  disputed: "var(--disputed)",
};

export function NatureBadge({ n }: { n: Nature }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", natureCls[n])}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: natureFill[n] }} />
      {NATURE_LABEL[n]}
    </span>
  );
}

export function ClassTag({ c }: { c: string }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">{c}</span>;
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      {title && (
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "primary" | "observed" | "disputed" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-medium", tone === "primary" && "text-primary", tone === "observed" && "text-observed", tone === "disputed" && "text-disputed")}>{value}</div>
    </div>
  );
}

export function Button({ children, variant = "primary", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border bg-secondary text-secondary-foreground hover:bg-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function AppHeader() {
  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded bg-primary font-mono text-xs font-bold text-primary-foreground">IQ</span>
          <span className="font-semibold tracking-tight">CargoIQ</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">Evidence & Dispute Intelligence</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link to="/diagnostics" className="hover:text-foreground">Diagnostics</Link>
          <button onClick={logout} className="rounded border bg-secondary px-2 py-1 text-xs hover:bg-accent">Sign out</button>
        </div>
      </div>
    </header>
  );
}
