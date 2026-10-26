import { frozenPackSummary } from "@/lib/feature-pack";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import {
  approveEvidencePack,
  generateEvidencePack,
  getEvidencePackPayload,
} from "@/lib/case.functions";
import { buildEvidencePackPdf, type EvidencePackInput } from "@/lib/pack-pdf";
import type { Database } from "@/integrations/supabase/types";

type PackRow = Pick<
  Database["public"]["Tables"]["evidence_packs"]["Row"],
  "id" | "version" | "sha256_hash" | "status" | "approved_by" | "generated_at"
>;
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/pack")({
  head: () => ({ meta: [{ title: "Evidence pack | CargoIQ" }] }),
  component: PackPage,
});

// Robust blob download: the anchor must be in the document (Firefox ignores
// programmatic clicks on detached anchors) and the object URL must outlive the
// download start (revoking synchronously after click() races and cancels the
// download in Firefox). Revoke on a delay instead.
export function downloadBlob(blob: Blob, filename: string, revokeDelayMs = 1000): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}

export function PackPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  const router = useRouter();
  const evidenceBlocked =
    data.clockBlocked || data.contradictions.some((c) => c.status === "FLAGGED");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const result = await generateEvidencePack({ data: { caseId } });
      setMessage("Evidence pack v" + result.pack.version + " generated. SHA-256: " + result.hash);
      await router.invalidate();
    } catch (err) {
      setMessage(
        err instanceof Error && err.message.includes("UNRESOLVED_CONTRADICTIONS")
          ? "Resolve the flagged contradictions before generating an evidence pack."
          : err instanceof Error
            ? err.message
            : "Could not generate evidence pack.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await approveEvidencePack({ data: { caseId, packId: id } });
      await router.invalidate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not approve pack.");
    } finally {
      setBusy(false);
    }
  }

  async function withPayload(
    pack: PackRow,
    fn: (full: PackRow & EvidencePackInput) => void,
    fallback: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const full = await getEvidencePackPayload({ data: { packId: pack.id } });
      fn({ ...pack, pack_payload: full.pack_payload as EvidencePackInput["pack_payload"] });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function exportJson(pack: PackRow) {
    withPayload(
      pack,
      (full) => {
        const blob = new Blob([JSON.stringify(full.pack_payload, null, 2)], {
          type: "application/json",
        });
        downloadBlob(blob, caseId + "-evidence-pack-v" + pack.version + ".json");
      },
      "Could not load pack payload.",
    );
  }

  function exportPdf(pack: PackRow) {
    withPayload(
      pack,
      (full) => {
        try {
          const bytes = buildEvidencePackPdf(full);
          const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
          downloadBlob(blob, caseId + "-evidence-pack-v" + pack.version + ".pdf");
        } catch (err) {
          setMessage(
            err instanceof Error
              ? "Could not build the PDF: " + err.message
              : "Could not build the PDF.",
          );
        }
      },
      "Could not load pack payload.",
    );
  }

  function exportSummary(pack: PackRow) {
    withPayload(
      pack,
      (full) => {
        const summary =
          "CargoIQ Evidence Pack v" +
          pack.version +
          "\nSHA-256: " +
          pack.sha256_hash +
          "\nStatus: " +
          pack.status +
          "\n\n" +
          frozenPackSummary(full.pack_payload ?? {});
        const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
        downloadBlob(blob, caseId + "-investigation-summary-v" + pack.version + ".txt");
      },
      "Could not load pack payload.",
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Panel
        title="Versions"
        action={
          <Button disabled={busy || evidenceBlocked} onClick={generate}>
            Generate frozen snapshot
          </Button>
        }
      >
        {evidenceBlocked && (
          <p role="alert" className="mb-4 rounded border border-disputed/50 p-3 text-sm">
            Blocked by unresolved clock evidence or flagged contradictions. Reconcile sources before
            freezing or approving a new pack. Existing frozen snapshots remain historical.
          </p>
        )}
        {message && (
          <div className="mb-4 rounded border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
            {message}
          </div>
        )}
        <ul className="space-y-3">
          {data.packs.map((p) => (
            <li
              key={p.id}
              className={cn("rounded-md border p-4", p.status === "SUPERSEDED" && "opacity-60")}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-xl text-primary">v{p.version}</span>
                  <span className="ml-3 rounded bg-secondary px-2 py-1 text-xs">{p.status}</span>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {new Date(p.generated_at).toISOString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => exportPdf(p)}>
                    PDF
                  </Button>
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => exportJson(p)}>
                    JSON
                  </Button>
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => exportSummary(p)}>
                    Summary
                  </Button>
                  {p.status === "DRAFT" && (
                    <Button
                      disabled={busy || evidenceBlocked}
                      className="py-1 text-xs"
                      onClick={() => approve(p.id)}
                    >
                      Approve
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-3 break-all rounded bg-panel px-3 py-2 font-mono text-[11px] text-muted-foreground">
                <span className="text-foreground">SHA-256</span> {p.sha256_hash}
              </div>
            </li>
          ))}
          {!data.packs.length && (
            <li className="py-10 text-center text-sm text-muted-foreground">
              No evidence packs yet. Resolve flagged contradictions, then generate the first
              snapshot.
            </li>
          )}
        </ul>
      </Panel>

      <Panel title="Integrity rules">
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>• Snapshot versions never overwrite prior content.</li>
          <li>
            • Integrated records must be frozen with sources, uncertainty and review history.
            Historical packs do not gain new records on export.
          </li>
          <li>• Hash is calculated over the canonical pack payload.</li>
          <li>• Public observations remain explicitly labelled as corroboration.</li>
          <li>• Approval is a human action and is written to the audit log.</li>
        </ul>
      </Panel>
    </div>
  );
}
