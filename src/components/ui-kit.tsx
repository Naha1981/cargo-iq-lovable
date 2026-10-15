import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
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

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => { setLight(document.documentElement.classList.contains("light")); }, []);
  function toggle() {
    const next = !light;
    document.documentElement.classList.toggle("light", next);
    try { localStorage.setItem("cargoiq-theme", next ? "light" : "dark"); } catch { /* storage unavailable */ }
    setLight(next);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      className="grid h-7 w-7 place-items-center rounded border bg-secondary text-foreground hover:bg-accent"
    >
      {light ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      )}
    </button>
  );
}

export function AppHeader({ public: isPublicPage = false }: { public?: boolean }) {
  // Public no-auth surfaces (e.g. /demo/*, signed-out landing) show no auth controls.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublicRoute = isPublicPage || pathname.startsWith("/demo");
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
          <ThemeToggle />
          {!isPublicRoute && (
            <button onClick={logout} className="rounded border bg-secondary px-2 py-1 text-xs hover:bg-accent">Sign out</button>
          )}
        </div>
      </div>
    </header>
  );
}

