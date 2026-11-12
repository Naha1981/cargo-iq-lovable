import { buildEvidencePackPdf } from "../../src/lib/pack-pdf";
import { splatProposal, SPLAT_SAMPLE, type SplatProposal } from "../../src/lib/visual-evidence";
const sourceFiles = [
  {
    id: "sample-release",
    name: "SAMPLE-release-note.txt",
    text: "FICTIONAL TEST RECORD - NOT CUSTOMER EVIDENCE\nSAMPLE-CIQ-001 release recorded: 2026-10-06T08:00:00Z\nOriginal synthetic record created for this demonstration.",
  },
  {
    id: "sample-gate",
    name: "SAMPLE-gate-register.txt",
    text: "FICTIONAL TEST RECORD - NOT CUSTOMER EVIDENCE\nSAMPLE-CIQ-001 collection ready: 2026-10-06T10:00:00Z\nSAMPLE-CIQ-001 gate out: 2026-10-06T16:00:00Z\nOriginal synthetic record created for this demonstration.",
  },
];
const events = [
  {
    id: "sample-event-release",
    timestamp: "2026-10-06T08:00:00Z",
    title: "Sample release recorded",
    source: "SAMPLE-release-note.txt / line 2",
    nature: "REPORTED",
    claim: "The sample release note records release at 08:00 UTC.",
    doc: sourceFiles[0].id,
  },
  {
    id: "sample-event-ready",
    timestamp: "2026-10-06T10:00:00Z",
    title: "Sample collection ready",
    source: "SAMPLE-gate-register.txt / line 2",
    nature: "REPORTED",
    claim: "The sample gate register records collection readiness at 10:00 UTC.",
    doc: sourceFiles[1].id,
  },
  {
    id: "sample-event-gate",
    timestamp: "2026-10-06T16:00:00Z",
    title: "Sample gate-out recorded",
    source: "SAMPLE-gate-register.txt / line 3",
    nature: "REPORTED",
    claim: "The sample gate register records gate-out at 16:00 UTC.",
    doc: sourceFiles[1].id,
  },
];
let selected = 0,
  capture: SplatProposal | null = null;
const el = (id: string) => document.getElementById(id)!;
function select(i: number) {
  selected = i;
  document
    .querySelectorAll<HTMLButtonElement>("[data-event]")
    .forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));
  el("claim").textContent = events[i].claim;
  el("source").textContent = events[i].source + " · " + events[i].timestamp;
  if (capture)
    el("captureMeta").textContent =
      "Capture at " +
      capture.capturedAt +
      " | Attached to " +
      events[selected].title +
      " (" +
      events[selected].timestamp +
      "). Scene acquisition: none (synthetic).";
}
select(0);
document
  .querySelectorAll<HTMLButtonElement>("[data-event]")
  .forEach((b, i) => (b.onclick = () => select(i)));
el("docs").textContent = sourceFiles.map((x) => x.name + "\n" + x.text).join("\n\n");
window.addEventListener("message", (e) => {
  const frame = el("viewer") as HTMLIFrameElement;
  if (
    e.origin !== location.origin ||
    e.source !== frame.contentWindow ||
    e.data?.type !== "cargo-splat-proposal"
  )
    return;
  const parsed = splatProposal.safeParse(e.data.item);
  if (!parsed.success) {
    el("status").textContent = "Invalid capture rejected. Nothing exported.";
    return;
  }
  capture = parsed.data;
  (el("captureImage") as HTMLImageElement).src = capture.imageJpeg;
  el("review").style.display = "block";
  el("captureHash").textContent = "JPEG SHA-256: " + capture.imageSha256;
  select(selected);
  (el("export") as HTMLButtonElement).disabled = false;
  el("export").textContent = "Download sample draft PDF";
  el("status").textContent = "Viewpoint ready. Review its limits, then export.";
});
const hash = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
el("export").onclick = async () => {
  if (!capture) return;
  const button = el("export") as HTMLButtonElement;
  button.disabled = true;
  try {
    const event = events[selected];
    const raw = Uint8Array.from(atob(capture.imageJpeg.split(",")[1]), (c) => c.charCodeAt(0));
    if ((await hash(raw)) !== capture.imageSha256) throw Error("Capture hash mismatch");
    const documents = await Promise.all(
      sourceFiles.map(async (x) => ({
        id: x.id,
        name: x.name,
        source_party: "Original synthetic sample record",
        uploaded_at: capture!.capturedAt,
        sha256_hash: await hash(new TextEncoder().encode(x.text)),
      })),
    );
    const payload = {
      generatedAt: capture.capturedAt,
      case: {
        reference_no: "SAMPLE-CIQ-001 / FICTIONAL TEST",
        title: "Consistent sample records with an illustrative Gaussian viewpoint",
        vessel_name: "Fictional sample vessel",
        container_no: "FICTIONAL-NOT-A-CONTAINER",
        port_code: "Illustrative harbour, not georeferenced",
        dispute_type: "SAMPLE ONLY - no real dispute",
      },
      documents: [
        ...documents,
        {
          id: "sample-viewpoint",
          name: "ILLUSTRATIVE Gaussian viewpoint.jpg",
          source_party: SPLAT_SAMPLE.source,
          sha256_hash: capture.imageSha256,
        },
      ],
      timeline: events,
      claims: [
        {
          id: "sample-selected-claim",
          document_id: event.doc,
          page_number: 1,
          claim_text: "SAMPLE / FICTIONAL: " + event.claim,
          status: "VERIFIED",
          nature: "REPORTED",
          confidence: 1,
        },
      ],
      contradictions: [],
      externalObservations: [
        {
          observation_type: "GAUSSIAN_SPLAT_VIEW",
          source: capture.source,
          observed_at: capture.capturedAt,
          payload: {
            ...capture,
            document_id: "sample-viewpoint",
            sha256: capture.imageSha256,
            selectedEventId: event.id,
            selectedClaimId: "sample-selected-claim",
            eventAt: event.timestamp,
            windowStart: "2026-10-06T08:00:00Z",
            windowEnd: "2026-10-06T16:00:00Z",
            provenanceNote:
              "SAMPLE DEMONSTRATION. Fictional records created for QA. Capture supplied by the browser. No authenticated save, database seal, custody history or court admissibility is demonstrated.",
          },
        },
      ],
      truthRule:
        "SAMPLE / FICTIONAL. Consistency inside a test fixture is not independent evidence or a real investigation.",
    };
    const packHash = await hash(new TextEncoder().encode(JSON.stringify(payload)));
    const pdf = buildEvidencePackPdf({
      status: "DRAFT",
      version: 1,
      generated_at: capture.capturedAt,
      test_hash: true,
      sha256_hash: packHash,
      pack_payload: payload,
    });
    const blob = new Blob([pdf], { type: "application/pdf" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "CargoIQ-SAMPLE-draft-pack.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    el("status").textContent =
      "Sample draft PDF downloaded (" +
      pdf.length.toLocaleString() +
      " bytes). Test hash, not database-sealed.";
    (window as unknown as { cargoSampleLastExport: unknown }).cargoSampleLastExport = {
      bytes: pdf.length,
      packHash,
      selectedEvent: event.id,
    };
  } catch (e) {
    el("status").textContent = "Export stopped: " + (e instanceof Error ? e.message : String(e));
  } finally {
    button.disabled = false;
  }
};
