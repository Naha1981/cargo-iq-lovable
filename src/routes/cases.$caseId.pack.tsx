import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { AUDIT, CONTRADICTIONS, TIMELINE, DOCS, CLAIMS, calcDemurrage, getCase, type AuditEntry } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/pack")({
  head: () => ({ meta: [{ title: "Evidence pack | CargoIQ" }, { name: "description", content: "Versioned, hashed evidence packs with human approval." }] }),
  component: PackPage,
});

interface Pack { v: number; at: string; hash: string; status: "Draft" | "Approved" | "Superseded"; payload: string }

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const CALC_IN = { start: "2026-08-05", release: "2026-08-15", freeDays: 5, rate: 175, units: 12, currency: "USD", rulesVersion: "v2.4 · SC-2025-114" };
const build = (v: number, at: string, caseId: string, approvals: AuditEntry[]) => JSON.stringify({
  case: getCase(caseId), version: v, generatedAt: at,
  summary: "Carrier start and release dates contradicted by AIS and terminal records; contract free time not applied.",
  documents: DOCS, claims: CLAIMS, timeline: TIMELINE, contradictions: CONTRADICTIONS,
  calculation: { inputs: CALC_IN, result: calcDemurrage(CALC_IN) },
  approvalHistory: approvals.filter((a) => /approved|generated/i.test(a.action)),
}, null, 2);

function PackPage() {
  const { caseId } = Route.useParams();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>(AUDIT);

  useEffect(() => {
    (async () => {
      const p1 = build(1, "2026-09-05 10:30", caseId, AUDIT.slice(0, 5)), p2 = build(2, "2026-09-08 16:12", caseId, AUDIT);
      setPacks([
        { v: 2, at: "2026-09-08 16:12", hash: await sha256(p2), status: "Draft", payload: p2 },
        { v: 1, at: "2026-09-05 10:30", hash: await sha256(p1), status: "Superseded", payload: p1 },
      ]);
    })();
  }, [caseId]);

  const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");
  const generate = async () => {
    const v = (packs[0]?.v ?? 0) + 1, at = now(), payload = build(v, at, caseId, audit);
    const hash = await sha256(payload);
    setPacks((p) => [{ v, at, hash, status: "Draft", payload }, ...p.map((x) => (x.status === "Draft" ? { ...x, status: "Superseded" as const } : x))]);
    setAudit((a) => [...a, { at, who: "L. Mokoena", action: `Evidence pack v${v} generated` }]);
  };
  const approve = (v: number) => {
    setPacks((p) => p.map((x) => (x.v === v ? { ...x, status: "Approved" } : x)));
    setAudit((a) => [...a, { at: now(), who: "L. Mokoena", action: `Evidence pack v${v} approved` }]);
  };
  const download = (p: Pack) => {
    const url = URL.createObjectURL(new Blob([p.payload], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${caseId}-evidence-pack-v${p.v}.json`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Panel title="Versions" action={<Button onClick={generate}>Generate new version</Button>}>
        <ul className="space-y-3">
          {packs.map((p) => (
            <li key={p.v} className={cn("rounded-md border p-4", p.status === "Superseded" && "opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xl text-primary">v{p.v}</span>
                  <span className={cn("rounded px-2 py-0.5 text-xs", p.status === "Approved" ? "bg-observed/15 text-observed" : p.status === "Draft" ? "bg-derived/15 text-derived" : "bg-secondary text-muted-foreground")}>{p.status}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.at}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => download(p)}>Export</Button>
                  {p.status === "Draft" && <Button className="py-1 text-xs" onClick={() => approve(p.v)}>Approve</Button>}
                </div>
              </div>
              <div className="mt-3 break-all rounded bg-panel px-3 py-2 font-mono text-[11px] text-muted-foreground"><span className="text-foreground">SHA-256</span> {p.hash}</div>
              <div className="mt-2 text-xs text-muted-foreground">Summary · {CLAIMS.length} claims · {TIMELINE.length} timeline events · calculation · approval history · · {CONTRADICTIONS.length} contradictions · {DOCS.length} source documents · immutable</div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Audit trail">
        <ol className="relative space-y-4 border-l pl-4">
          {[...audit].reverse().map((a, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
              <div className="font-mono text-[11px] text-muted-foreground">{a.at} · {a.who}</div>
              {a.action}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
