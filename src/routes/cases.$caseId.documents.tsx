import { assertDocumentSize, isPlainDocument } from "@/lib/extraction-policy";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button, ClassTag, NatureBadge, Panel } from "@/components/ui-kit";
import { registerDocument, resolveContradiction, reviewClaim, runDocumentExtraction } from "@/lib/case.functions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/documents")({
  head: () => ({ meta: [{ title: "Documents & contradictions | CargoIQ" }] }),
  component: DocsPage,
});

function DocsPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [sourceParty, setSourceParty] = useState("");
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, { explanation: string; documentId: string; reference: string }>>({});
  function draft(id: string) { return resolutionDrafts[id] ?? { explanation: "", documentId: "", reference: "" }; }
  function editDraft(id: string, key: "explanation" | "documentId" | "reference", value: string) {
    setResolutionDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? { explanation: "", documentId: "", reference: "" }), [key]: value } }));
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decisions, setDecisions] = useState<Record<string, "VERIFIED" | "DISPUTED">>({});
  const supabase = createClient();

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    if (sourceParty.trim().length < 2) { setError("Enter the organization that supplied these records before uploading."); return; }
    setBusy(true);
    setError("");
    try {
      for (const item of Array.from(files)) {
        assertDocumentSize(item.size);
        const safeName = item.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = data.tenantId + "/" + caseId + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await supabase.storage.from("case-documents").upload(path, item, { upsert: false });
        if (uploadError) throw uploadError;
        await registerDocument({
          data: {
            caseId,
            filePath: path,
            name: item.name,
            fileType: item.type || "application/octet-stream",
            sourceParty: sourceParty.trim(),
          },
        });
      }
      await router.invalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(/failed to fetch|network|load failed/i.test(message)
        ? "The file could not reach private document storage. Check your connection and try again. If it keeps failing, ask the workspace owner to check the case-documents bucket and tenant upload policy in Lovable Cloud."
        : message);
    } finally {
      setBusy(false);
    }
  }

  async function extract(id: string, noAi = false) {
    setBusy(true);
    setError("");
    try {
      setNotice("");
      const result = await runDocumentExtraction({ data: { documentId: id, caseId, noAi } });
      setNotice(result.skippedDuplicates ? "No new claims: these lines are already imported." : result.mode === "ai" ? `${result.count} AI claims extracted. Review each claim before verification.` : `${result.count} text lines imported without AI credits. No event understanding or automatic timestamps. Review each line; this is not AI extraction.`);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function review(claimId: string, decision: "VERIFIED" | "DISPUTED") {
    // Optimistic: show the decision in place immediately; roll back if the write fails.
    setDecisions((prev) => ({ ...prev, [claimId]: decision }));
    try {
      await reviewClaim({ data: { claimId, caseId, decision } });
      await router.invalidate();
    } catch (err) {
      setDecisions((prev) => { const next = { ...prev }; delete next[claimId]; return next; });
      setError(err instanceof Error ? err.message : "Could not record the review decision.");
    }
  }

  async function resolve(id: string) {
    const value = draft(id);
    setBusy(true); setError("");
    try {
      await resolveContradiction({ data: { contradictionId: id, caseId, explanation: value.explanation,
        supportingDocumentId: value.documentId, evidenceReference: value.reference } });
      await router.invalidate();
    } catch (err) { setError(err instanceof Error ? err.message : "Resolution failed; the conflict remains open."); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
      <Panel title={"Documents · " + data.documents.length} action={
        <>
          <input ref={file} type="file" multiple hidden accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" onChange={(e) => onUpload(e.target.files)} />
          <Button disabled={busy} variant="ghost" className="py-1 text-xs" onClick={() => file.current?.click()}>+ Upload</Button>
        </>
      }>
        {error && <div className="mb-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-xs text-disputed">{error}</div>}
        <p className="mb-3 text-xs text-muted-foreground">PDF, TXT or CSV, up to 5 MB per file. TXT/CSV: choose Import text for a no-AI option (up to 500 lines and 200,000 characters). Human review is always required.</p>
        {notice && <div role="status" className="mb-3 rounded border p-3 text-xs">{notice}</div>}
        <label className="mb-4 block text-sm">Source organization for this upload
          <input value={sourceParty} maxLength={200} onChange={e=>setSourceParty(e.target.value)} placeholder="Organization that supplied the record" className="mt-2 w-full rounded border bg-background p-2 text-sm" />
          <span className="mt-1 block text-xs text-muted-foreground">Applies to every file in this selection. Upload different organizations separately.</span>
        </label>
        <ul className="divide-y">
          {data.documents.map((d: any) => (
            <li key={d.id} className="flex items-start gap-3 px-2 py-3">
              <div className="grid h-10 w-8 shrink-0 place-items-center rounded-sm border bg-panel font-mono text-[9px] text-muted-foreground">{d.file_type.split("/").pop()?.slice(0, 6).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">Source: {d.source_party || "Not recorded (legacy upload)"}</div>
                <div className="mt-1 text-xs text-muted-foreground">{d.sha256_hash.slice(0, 12)}… · {d.evidence_class}</div>
                <Button disabled={busy} variant="ghost" className="mt-2 py-1 text-xs" onClick={() => extract(d.id)}>Extract claims with AI</Button>
                {isPlainDocument(d.file_type, d.name) && <Button disabled={busy} variant="ghost" className="mt-2 py-1 text-xs" onClick={() => extract(d.id, true)}>Import text (no AI credits)</Button>}
              </div>
            </li>
          ))}
          {!data.documents.length && <li className="py-10 text-center text-sm text-muted-foreground">Upload Bills of Lading, terminal records, carrier notices or invoices.</li>}
        </ul>
      </Panel>

      <div className="space-y-6">
        <Panel title={"Extracted claims · " + data.claims.length}>
          <ul className="divide-y">
            {data.claims.map((c: any) => {
              const status: string = decisions[c.id] ?? c.status;
              return (
              <li key={c.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">p.{c.page_number ?? "?"}</span>
                    <NatureBadge n={String(c.nature).toLowerCase() as any} />
                    <ClassTag c={c.evidence_class} />
                    <span className="font-mono">conf {Math.round(Number(c.confidence ?? 0) * 100)}%</span>
                    {status !== "PENDING" && (
                      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", status === "VERIFIED" ? "bg-observed/15 text-observed" : "bg-disputed/15 text-disputed")}>{status}</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm">{c.claim_text}</div>
                  {c.timestamp_claimed && <div className="mt-1 font-mono text-xs text-primary">{c.timestamp_claimed} UTC</div>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => review(c.id, "VERIFIED")} className={cn("rounded border px-2.5 py-1 text-xs", status === "VERIFIED" ? "border-observed bg-observed/15 text-observed" : "hover:bg-accent")}>{status === "VERIFIED" ? "Verified" : "Verify"}</button>
                  <button onClick={() => review(c.id, "DISPUTED")} className={cn("rounded border px-2.5 py-1 text-xs", status === "DISPUTED" ? "border-disputed bg-disputed/15 text-disputed" : "hover:bg-accent")}>{status === "DISPUTED" ? "Disputed" : "Dispute"}</button>
                </div>
              </li>
              );
            })}
            {!data.claims.length && <li className="py-10 text-center text-sm text-muted-foreground">Extraction claims will appear here for human review.</li>}
          </ul>
        </Panel>

        <Panel title={"Contradictions · " + data.contradictions.filter((c: any) => c.status === "FLAGGED").length + " flagged"}>
          <div className="space-y-3">
            {data.contradictions.map((c: any) => (
              <div key={c.id} className="rounded-md border p-4">
                <div className="flex items-center justify-between"><span className="font-medium">{c.title}</span><span className={cn("rounded px-2 py-1 text-xs", c.status === "RESOLVED" ? "bg-observed/15 text-observed" : "bg-disputed/15 text-disputed")}>{c.status}</span></div>
                <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>
                {c.status === "FLAGGED" && <div className="mt-4 space-y-3">
                  <label className="block text-sm">Resolution explanation<textarea value={draft(c.id).explanation} onChange={e=>editDraft(c.id,"explanation",e.target.value)} minLength={10} maxLength={4000} className="mt-1 min-h-24 w-full rounded border bg-background p-2" placeholder="Explain how the competing records were reconciled and what remains uncertain." /></label>
                  <label className="block text-sm">Supporting case document<select value={draft(c.id).documentId} onChange={e=>editDraft(c.id,"documentId",e.target.value)} className="mt-1 w-full rounded border bg-background p-2"><option value="">Select source evidence</option>{data.documents.map((d:any)=><option key={d.id} value={d.id}>{d.name} ({d.source_party || "source not recorded"})</option>)}</select></label>
                  <label className="block text-sm">Evidence location / reference<input value={draft(c.id).reference} onChange={e=>editDraft(c.id,"reference",e.target.value)} maxLength={1000} className="mt-1 w-full rounded border bg-background p-2" placeholder="Page, row, event ID or section supporting the decision" /></label>
                  <Button disabled={busy || draft(c.id).explanation.trim().length<10 || !draft(c.id).documentId || draft(c.id).reference.trim().length<3} variant="ghost" className="py-1 text-xs" onClick={() => resolve(c.id)}>Save evidenced resolution</Button>
                </div>}
                {c.status === "RESOLVED" && <div className="mt-3 text-sm"><p>{c.resolution_note || "Legacy resolution: no explanation captured."}</p><p className="mt-1 text-xs text-muted-foreground">Evidence: {data.documents.find((d:any)=>d.id===c.resolution_document_id)?.name || c.resolution_document_id || "Not recorded"} · {c.resolution_evidence_reference || "No reference recorded"}</p></div>}
              </div>
            ))}
            {!data.contradictions.length && <p className="py-8 text-center text-sm text-muted-foreground">No contradictions have been detected.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

