import { createFileRoute, Link } from "@tanstack/react-router";
import { runDiagnostics } from "@/lib/auth.functions";

export const Route = createFileRoute("/diagnostics")({
  ssr: false,
  loader: () => runDiagnostics(),
  head: () => ({ meta: [
    { title: "Setup diagnostics | CargoIQ" },
    { name: "description", content: "Check CargoIQ backend connection, database readiness and workspace access." },
    { property: "og:title", content: "Setup diagnostics | CargoIQ" },
    { property: "og:description", content: "Check CargoIQ backend connection, database readiness and workspace access." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  errorComponent: ({ error }) => <div className="p-10 text-sm text-disputed">Diagnostics failed: {String((error as Error)?.message ?? error)}</div>,
  component: Diagnostics,
});

function Diagnostics() {
  const checks = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Investigations</Link>
      <h1 className="mt-2 text-2xl font-semibold">Setup diagnostics</h1>
      <ul className="mt-6 space-y-3">
        {checks.map((c) => (
          <li key={c.name} className="rounded-md border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.name}</span>
              <span className={c.ok ? "text-observed text-xs font-mono" : "text-disputed text-xs font-mono"}>{c.ok ? "OK" : "ACTION NEEDED"}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{c.detail}</p>
            {!c.ok && c.fix && <p className="mt-1 text-sm">How to fix: {c.fix}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
