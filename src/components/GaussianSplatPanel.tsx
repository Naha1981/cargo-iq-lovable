import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { createClient } from "@/lib/supabase/client";
import { splatProposal, type SplatProposal } from "@/lib/visual-evidence";
import { addSplatSnapshot } from "@/lib/splat-snapshot.functions";

export function GaussianSplatPanel({ caseId, tenantId }: { caseId: string; tenantId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [proposal, setProposal] = useState<SplatProposal | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setProposal(null);
    setNotice("");
  }, [caseId]);
  useEffect(() => {
    function message(e: MessageEvent) {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow ||
        e.data?.type !== "cargo-splat-proposal"
      )
        return;
      const parsed = splatProposal.safeParse(e.data.item);
      if (parsed.success) {
        setProposal(parsed.data);
        setNotice("");
      } else setNotice("Invalid viewpoint capture. Nothing saved.");
    }
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, []);
  return (
    <section className="space-y-3 rounded border bg-card p-4">
      <h2 className="text-lg font-semibold">Gaussian-splat scene study</h2>
      <p className="text-sm text-muted-foreground">
        Original illustrative scene, not a scan of this shipment. Rotate the scene and capture a
        viewpoint. A PDF contains a still and its source record, not an interactive 3D scene.
      </p>
      <iframe
        ref={frame}
        src="/splat-sample/"
        title="Illustrative Gaussian harbour viewer"
        className="h-[850px] w-full rounded border"
      />
      {proposal && (
        <div
          className="space-y-2 rounded border border-amber-600 p-4"
          aria-label="Review illustrative viewpoint"
        >
          <strong>Illustrative only. Not shipment evidence.</strong>
          <p className="text-sm">{proposal.limitations}</p>
          <img
            src={proposal.imageJpeg}
            alt="Proposed illustrative Gaussian viewpoint"
            className="max-h-64"
          />
          <p className="text-xs">
            Capture: {proposal.capturedAt}. Scene acquisition: none. Source: {proposal.source} (
            {proposal.licence}).
          </p>
          <button
            disabled={busy}
            className="min-h-11 rounded border px-4"
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                const bytes = Uint8Array.from(atob(proposal.imageJpeg.split(",")[1]!), (c) =>
                  c.charCodeAt(0),
                );
                const filePath =
                  tenantId + "/" + caseId + "/" + crypto.randomUUID() + "-illustrative-splat.jpg";
                const { error } = await createClient()
                  .storage.from("case-documents")
                  .upload(filePath, new Blob([bytes], { type: "image/jpeg" }), {
                    upsert: false,
                    contentType: "image/jpeg",
                  });
                if (error) throw error;
                const { imageJpeg: _image, ...metadata } = proposal;
                const result = await addSplatSnapshot({
                  data: { caseId, filePath, proposal: metadata },
                });
                setNotice(
                  "Illustrative viewpoint saved. Generate a NEW pack to include it. Previous packs unchanged. JPEG SHA-256: " +
                    result.sha256,
                );
                setProposal(null);
                await router.invalidate();
              } catch (e) {
                setNotice(
                  e instanceof Error
                    ? e.message
                    : "Save not confirmed. Inspect case documents before retrying.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm save as illustrative exhibit
          </button>
          <button
            disabled={busy}
            onClick={() => setProposal(null)}
            className="min-h-11 rounded border px-4"
          >
            Cancel
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="break-words text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
