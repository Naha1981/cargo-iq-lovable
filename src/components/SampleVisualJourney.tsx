import { useEffect, useRef, useState } from "react";
import {
  PublicHarbourMap,
  PublicCorridor,
  PublicSimulation,
  PublicGeospatial,
  SavedSampleFootage,
} from "./PublicSampleTools";
import { HarbourCameras } from "./HarbourCameras";
import { demoRecords } from "@/lib/cuf-demo";
import {
  sampleVisualCapture,
  exportCountingSample,
  type SampleVisualCapture,
} from "@/lib/sample-visual-pack";

const views = [
  "Harbour Map",
  "Harbour globe",
  "Simulation Lab",
  "Corridor",
  "3D Scene",
  "Geospatial",
  "Saved CCTV footage",
  "Recorded player",
  "Cameras",
  "3D Gaussian scene",
  "Real-world splat",
  "Timeline",
  "Draft pack",
] as const;
export function SampleVisualJourney() {
  const [view, setView] = useState<(typeof views)[number]>("Harbour globe");
  const [selectedId, setSelectedId] = useState("Q02");
  const [captures, setCaptures] = useState<SampleVisualCapture[]>([]);
  const [cameraIncluded, setCameraIncluded] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selected = demoRecords.find((r) => r.record_id === selectedId)!;
  useEffect(() => {
    function message(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "harbour-open-pack") {
        setView("Draft pack");
        return;
      }
      if (e.data?.type === "cargo-shipment-request") {
        frameRef.current?.contentWindow?.postMessage(
          { type: "cargo-shipment-location", position: null },
          location.origin,
        );
        return;
      }
      if (e.data?.type !== "cargo-splat-proposal") return;
      const c = sampleVisualCapture.safeParse(e.data.item);
      if (!c.success) {
        setNotice("Capture rejected: source or format not recognised.");
        return;
      }
      setCaptures((old) => [
        ...old.filter((x) => x.classification !== c.data.classification),
        c.data,
      ]);
      setNotice(
        "Viewpoint retained for claim " +
          selectedId +
          ". Browser memory only; review in Draft pack.",
      );
    }
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [selectedId]);
  async function download() {
    setBusy(true);
    try {
      const r = await exportCountingSample({
        selectedRecordId: selectedId,
        captures,
        camera: cameraIncluded,
      });
      const u = URL.createObjectURL(new Blob([new Uint8Array(r.pdf)], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = u;
      a.download = "CargoIQ-counting-SAMPLE-unresolved-draft.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
      setNotice(
        "Downloaded " +
          r.pdf.length.toLocaleString() +
          "-byte SAMPLE DRAFT. Unresolved conflict retained; test hash, not a seal.",
      );
    } catch (e) {
      setNotice("Export stopped: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Visual sample journey" className="sample-visual-journey">
      <style>{`.sample-visual-journey{margin:24px 0;border:1px solid #bcc9cb;background:#f4f6f4;border-radius:8px;overflow:hidden;color:#17343d}.sv-heading{padding:20px 24px;background:#fff;border-bottom:1px solid #ccd6d5}.sv-heading h2{font-size:23px;font-weight:650;margin:4px 0}.sv-kicker{font-size:11px;color:#93631f;letter-spacing:.08em;font-weight:700}.sv-mobile-view{display:none}.sv-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:16px 24px}.sv-tabs button{min-height:44px;border:1px solid #aebec1;border-radius:5px;padding:9px 16px;background:white;color:#17343d}.sv-tabs button[aria-pressed=true]{background:#17343d;color:white}.sv-screen{padding:0 20px 20px}.sv-screen iframe{width:100%;height:580px;border:1px solid #bac9cb;border-radius:6px;background:#162e38}.sv-context{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:0 24px 20px}.sv-context article{border-left:3px solid #b3853f;padding:6px 12px;background:#fff}.sv-heading p{max-width:70ch}.sv-screen button{min-height:44px;padding:10px;border:1px solid #aec0c4;border-radius:4px;background:#fff;color:#17343d}.sample-visual-journey select{display:block;max-width:100%;width:100%;padding:10px;border:1px solid #adbec1;border-radius:4px;margin-top:6px}.sv-context small{display:block;color:#60757b;margin-top:5px}.sv-note{padding:10px 16px;margin:0 0 14px;background:#faf3e4;color:#71501e;font-size:13px;line-height:1.5}.sv-camera{background:#fff;border:1px solid #cbd6d7;padding:24px;min-height:220px}.sv-camera h3{font-size:20px;margin-bottom:10px}@media(max-width:640px){.sv-tabs{display:none}.sv-mobile-view{display:block;padding:16px}.sv-context{grid-template-columns:1fr}.sv-heading,.sv-tabs{padding:16px}.sv-screen{padding:0 12px 12px}.sv-screen iframe{height:620px}}`}</style>
      <div className="sv-heading">
        <span className="sv-kicker">FICTIONAL WORKED EXAMPLE / TEST COPY</span>
        <h2>Explore the place. Review the record. Build the pack.</h2>
        <p>Maps, cameras and a rotatable 3D scene alongside the counting and clock review.</p>
      </div>
      <div style={{ padding: "16px 24px", background: "#fff" }}>
        <label>
          Selected sample source claim{" "}
          <select
            aria-label="Selected sample source claim"
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setCaptures([]);
              setCameraIncluded(false);
              setNotice(
                "Claim changed. Prior reference selection cleared, not silently reassigned.",
              );
            }}
          >
            {demoRecords.map((r) => (
              <option key={r.record_id} value={r.record_id}>
                {r.record_id} · {r.claim_type} · {r.timestamp_utc || "time not supplied"}
              </option>
            ))}
          </select>
        </label>
        <p>
          <strong>{selected.statement}</strong>
        </p>
        <p style={{ fontSize: 12 }}>
          {selected.source_party} / {selected.record_id} · Event:{" "}
          {selected.timestamp_utc || "Not supplied"} · Window: 14 October 2026, 06:00-20:00 UTC
        </p>
        <p role="status">{notice}</p>
      </div>
      <label className="sv-mobile-view">
        Visual tool
        <select
          aria-label="Visual tool"
          value={view}
          onChange={(e) => setView(e.target.value as (typeof views)[number])}
        >
          {views.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <nav className="sv-tabs" aria-label="Visual journey views">
        {views.map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </nav>
      <div className="sv-screen">
        {view === "Harbour Map" && <PublicHarbourMap />}
        {view === "Simulation Lab" && <PublicSimulation />}
        {view === "Corridor" && <PublicCorridor />}
        {view === "Geospatial" && <PublicGeospatial />}
        {view === "Saved CCTV footage" && <SavedSampleFootage />}
        {view === "Recorded player" && (
          <>
            <p className="sv-note">
              Historic railway player example, not Durban or case evidence. Saved Durban clips are
              under Saved CCTV footage.
            </p>
            <video
              style={{ width: "100%" }}
              controls
              playsInline
              preload="metadata"
              src="/harbour-view/media/railway-reference-1939.mp4"
              aria-label="Historic recorded player example"
            />
          </>
        )}

        {view === "Harbour globe" && (
          <>
            <p className="sv-note">
              Reference map of Durban today, not a reconstruction of 14 October. Vessel markers are
              external AIS reports, not this fictional shipment. The source records do not supply
              verified coordinates for the truck or boxes, so none are invented.
            </p>
            <iframe
              ref={frameRef}
              src="/harbour-view/index.html?embed=1&sample=0"
              title="Durban reference harbour globe"
            />
          </>
        )}
        {view === "Cameras" && (
          <div className="sv-camera">
            <h3>Look at the harbour cameras</h3>
            <p className="sv-note">
              Recorded reference still, retrieved 12 November 2026 at 09:33 SAST. Camera overlay
              reads 09:33:05; its clock/timezone is not independently verified. This is not footage
              of the 14 October sample event.
            </p>
            <img
              src="/sample-camera/pyc-marina-20261112-093305-source.jpg"
              alt="Unmodified PYC Marina camera still, 12 November 2026"
              style={{ width: "100%", borderRadius: 6 }}
            />
            <p style={{ fontSize: 12 }}>
              PYC Marina / Point Yacht Club. Stream sponsored by EdgeConnect. CC BY 4.0 as declared
              by source config, author field blank. Unmodified source JPEG.{" "}
              <a
                href="https://restreamer.cd.net.za/c1b53a50-06bb-47da-916a-01fb19d5c547.html"
                target="_blank"
                rel="noreferrer"
              >
                Open source
              </a>{" "}
              ·{" "}
              <a href="/sample-camera/manifest.json" target="_blank" rel="noreferrer">
                Source, time, hash and limits
              </a>
            </p>
            <p>
              No server case save.{" "}
              <button
                onClick={() => {
                  setCameraIncluded(true);
                  setNotice(
                    "PYC Marina reference selected for claim " +
                      selectedId +
                      ". Review in Draft pack; not evidence of this event.",
                  );
                }}
              >
                Include reference still in sample draft
              </button>
            </p>
            <HarbourCameras />
          </div>
        )}
        {(view === "3D Gaussian scene" || view === "3D Scene") && (
          <>
            <p className="sv-note">
              Original illustrative harbour, not a Durban scan or historical evidence. Rotate, zoom
              and capture a viewpoint. A real-place, openly licensed scene is being checked
              separately.
            </p>
            <iframe
              ref={frameRef}
              src="/splat-sample/index.html?embed=1"
              title="Illustrative Gaussian harbour scene"
            />
          </>
        )}
        {view === "Real-world splat" && (
          <>
            <p className="sv-note">
              Tree by Yvig, CC BY 4.0. Real-world iPhone capture, not a port or cargo scan. Exact
              location and acquisition time are not supplied. Converted to standard splat format
              from the source low-resolution file.
            </p>
            <iframe
              ref={frameRef}
              src="/splat-real-tree/index.html?embed=1"
              title="Real-world Tree Gaussian reference"
            />
          </>
        )}
        {view === "Timeline" && (
          <div className="sv-camera">
            <h3>Same source-linked sample timeline</h3>
            {demoRecords
              .filter((r) => r.timestamp_utc)
              .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc))
              .map((r) => (
                <button
                  key={r.record_id}
                  onClick={() => {
                    setSelectedId(r.record_id);
                    setCaptures([]);
                    setCameraIncluded(false);
                  }}
                  style={{
                    display: "block",
                    textAlign: "left",
                    width: "100%",
                    padding: 12,
                    borderLeft:
                      r.record_id === selectedId ? "4px solid #a87327" : "4px solid #ccd4d2",
                    marginBottom: 8,
                  }}
                >
                  <strong>
                    {r.timestamp_utc} · {r.record_id}
                  </strong>
                  <br />
                  {r.statement}
                  <br />
                  <small>
                    {r.source_party} · {r.event_reference}
                  </small>
                </button>
              ))}
          </div>
        )}
        {view === "Draft pack" && (
          <div className="sv-camera">
            <h3>Review this worked-example draft</h3>
            <p className="sv-note">
              SYN-COUNT-CLOCK-01, 14 October 2026. The 18:00/19:00 gate-in conflict stays OPEN. This
              is an unresolved review draft, not ready for a claim submission. No money, liability,
              server save or database seal.
            </p>
            <p>
              Selected claim: {selectedId}. Same 15 fictional source records and timeline. Camera
              still: {cameraIncluded ? "selected, current reference only" : "not selected"}.
              Captured 3D viewpoints: {captures.length}.
            </p>
            {captures.map((c) => (
              <figure key={c.classification}>
                <img
                  src={c.imageJpeg}
                  alt={c.classification + " retained viewpoint"}
                  style={{ maxWidth: "100%", maxHeight: 220 }}
                />
                <figcaption>
                  {c.source} · {c.capturedAt}. Not the event acquisition time.
                </figcaption>
              </figure>
            ))}
            <button disabled={busy || (!captures.length && !cameraIncluded)} onClick={download}>
              {busy ? "Preparing draft..." : "Download unresolved sample draft PDF"}
            </button>
            <p>
              Only selected references are included. Source, credit, hashes, camera pose, claim ID,
              event time and limitations travel with each reference. The image does not verify the
              claim.
            </p>
          </div>
        )}
      </div>
      <div className="sv-context">
        <article>
          <strong>TRUCK-SYN-01</strong>
          <small>One vehicle visit, two boxes. Position not supplied.</small>
        </article>
        <article>
          <strong>SYN-C01 + SYN-C02</strong>
          <small>Fictional containers. No tracking position inferred.</small>
        </article>
        <article>
          <strong>18:00 or 19:00 UTC?</strong>
          <small>Same gate-in, conflicting source times. Review below.</small>
        </article>
      </div>
    </section>
  );
}
