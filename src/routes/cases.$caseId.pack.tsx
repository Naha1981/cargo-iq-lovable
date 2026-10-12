import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { approveEvidencePack, generateEvidencePack, getCaseWorkspace } from "@/lib/case.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/pack")({
  loader: ({ params }) => getCaseWorkspace({ data: { caseId: params.caseId } }),
  head: () => ({ meta: [{ title: "Evidence pack | CargoIQ" }] }),
  component: PackPage,
});

function PackPage() {
  const { caseId } = Route.useParams();
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function generate() {
    setBusy(true); setMessage("");
    try {
      const result = await generateEvidencePack({ data: { caseId } });
      setMessage("Evidence pack v" + result.pack.version + " generated. SHA-256: " + result.hash);
      await router.invalidate();
    } catch (err) {
      setMessage(err instanceof Error && err.message.includes("UNRESOLVED_CONTRADICTIONS")
        ? "Resolve the flagged contradictions before generating an evidence pack."
        : err instanceof Error ? err.message : "Could not generate evidence pack.");
    } finally { setBusy(false); }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await approveEvidencePack({ data: { caseId, packId: id } });
      await router.invalidate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not approve pack.");
    } finally { setBusy(false); }
  }

  function exportJson(pack: any) {
    const blob = new Blob([JSON.stringify(pack.pack_payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = caseId + "-evidence-pack-v" + pack.version + ".json"; a.click(); URL.revokeObjectURL(url);
  }

  function exportSummary(pack: any) {
    const timeline = (pack.pack_payload.timeline ?? []).map((x: any) => x.timestamp + " — " + x.title).join("\n");
    const summary = "CargoIQ Evidence Pack v" + pack.version + "\nSHA-256: " + pack.sha256_hash + "\nStatus: " + pack.status + "\n\n" + timeline;
    const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = caseId + "-investigation-summary-v" + pack.version + ".txt"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Panel title="Versions" action={<Button disabled={busy} onClick={generate}>Generate frozen snapshot</Button>}>
        {message && <div className="mb-4 rounded border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">{message}</div>}
        <ul className="space-y-3">
          {data.packs.map((p: any) => (
            <li key={p.id} className={cn("rounded-md border p-4", p.status === "SUPERSEDED" && "opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-xl text-primary">v{p.version}</span>
                  <span className="ml-3 rounded bg-secondary px-2 py-1 text-xs">{p.status}</span>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{new Date(p.generated_at).toISOString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => exportJson(p)}>JSON</Button>
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => exportSummary(p)}>Summary</Button>
                  {p.status === "DRAFT" && <Button className="py-1 text-xs" onClick={() => approve(p.id)}>Approve</Button>}
                </div>
              </div>
              <div className="mt-3 break-all rounded bg-panel px-3 py-2 font-mono text-[11px] text-muted-foreground"><span className="text-foreground">SHA-256</span> {p.sha256_hash}</div>
            </li>
          ))}
          {!data.packs.length && <li className="py-10 text-center text-sm text-muted-foreground">No evidence packs yet. Resolve flagged contradictions, then generate the first snapshot.</li>}
        </ul>
      </Panel>

      <Panel title="Integrity rules">
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>• Snapshot versions never overwrite prior content.</li>
          <li>• Hash is calculated over the canonical pack payload.</li>
          <li>• Public observations remain explicitly labelled as corroboration.</li>
          <li>• Approval is a human action and is written to the audit log.</li>
        </ul>
      </Panel>
    </div>
  );
}

