import { useState } from "react";
import { CorridorMap } from "./CorridorView";
import { HarbourEvidenceMap } from "./HarbourEvidenceMap";
import { publicSampleWorkspace } from "@/lib/public-sample-workspace";
import { compareBaselineToScenario } from "@/lib/simulation";
export function PublicHarbourMap() {
  return (
    <>
      <p className="sv-note">
        The same Harbour Map renderer as the case workspace. Same 15 fictional source records. No
        AIS positions or truck coordinates were supplied; none are invented. Saving to a customer
        case and provider ingestion are disabled in this public sample.
      </p>
      <HarbourEvidenceMap data={publicSampleWorkspace} publicSample />
    </>
  );
}
export function PublicCorridor() {
  return (
    <>
      <p className="sv-note">
        Native Corridor map, with the N3 and ports as geographic reference only. No fictional
        shipment positions are plotted. Drag, zoom, switch 2D/3D and toggle layers.
      </p>
      <CorridorMap
        events={[]}
        portCode="DUR"
        fixtureLabel="FICTIONAL SAMPLE - geographic references only"
      />
    </>
  );
}
export function PublicSimulation() {
  const [port, setPort] = useState("DUR");
  const [assumption, setAssumption] = useState(
    "Hypothetical port congestion; no independent risk evidence supplied.",
  );
  const [result, setResult] = useState<ReturnType<typeof compareBaselineToScenario> | null>(null);
  return (
    <div className="sv-camera">
      <h3>Simulation Lab</h3>
      <p className="sv-note">
        Public sample using the native deterministic scope engine, not the database-backed
        scenario/audit workspace. Assumptions never change source records or resolve the clock
        conflict.
      </p>
      <label>
        Scenario port
        <select
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
            setResult(null);
          }}
        >
          <option value="DUR">Durban (matches sample)</option>
          <option value="CPT">Cape Town (does not match sample)</option>
        </select>
      </label>
      <label>
        Hypothetical assumption
        <input
          style={{ width: "100%", padding: 12, border: "1px solid #aebec1" }}
          value={assumption}
          onChange={(e) => {
            setAssumption(e.target.value);
            setResult(null);
          }}
        />
      </label>
      <button
        onClick={() =>
          setResult(
            compareBaselineToScenario(
              {
                name: "Public sample scenario",
                scenarioType: "port_congestion",
                portCode: port,
                severity: "medium",
                assumptions: assumption.trim() ? [{ text: assumption, source: "user" }] : [],
              },
              [
                {
                  id: "SYN-COUNT-CLOCK-01",
                  reference_no: "SYN-COUNT-CLOCK-01",
                  port_code: "DUR",
                  corridor: null,
                  vessel_name: null,
                },
              ],
              [],
            ),
          )
        }
      >
        Run sample comparison
      </button>
      {result && (
        <div role="status">
          <p>
            Sample cases in scope: {result.shipmentsExposed}. Confirmed risk records:{" "}
            {result.verifiedEvidenceCount}.
          </p>
          <p>ASSUMPTION: {assumption}</p>
          <ul>
            {[...result.evidenceGaps, ...result.insufficientData].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p>No delay, money or liability estimate is invented. Browser memory only.</p>
        </div>
      )}
    </div>
  );
}
export function SavedSampleFootage() {
  return (
    <div className="sv-camera">
      <h3>Saved CCTV references</h3>
      <p className="sv-note">
        Two real 30-second public-camera excerpts captured 12 November 2026 around 12:56-12:57 SAST,
        saved as static files and retained across page reload. Not live. Not footage of the
        fictional 14 October event. No server encryption is needed for these deliberately public
        licensed references.
      </p>
      {["marina", "beach"].map((key) => (
        <article key={key} style={{ margin: "20px 0" }}>
          <h4>PYC {key === "marina" ? "Marina" : "Beach"}</h4>
          <video
            controls
            playsInline
            preload="metadata"
            poster={"/sample-footage/" + key + "-poster.jpg"}
            style={{ width: "100%", borderRadius: 6 }}
            aria-label={"Saved PYC " + key + " footage"}
            src={"/sample-footage/" + key + "-20261112.mp4"}
          />
          <p>
            PYC {key === "marina" ? "Marina" : "Beach"} / Point Yacht Club; stream hosted by
            EdgeConnect. Source config author field blank.{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            . 30-second excerpt, re-encoded to H.264, audio removed, no crop. No endorsement.
          </p>
        </article>
      ))}
      <a href="/sample-footage/manifest.json" target="_blank" rel="noreferrer">
        Source URLs, capture window, duration, hashes and limitations
      </a>
      <p>
        Customer CCTV ingest, permissions, audit and authenticated case save are separate and not
        activated by this reference demo.
      </p>
    </div>
  );
}

import scenes from "@/lib/sample-geospatial.json";
export function PublicGeospatial() {
  const [side, setSide] = useState(50);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  return (
    <div className="sv-camera">
      <h3>Geospatial review</h3>
      <p className="sv-note">
        Real Copernicus Sentinel tile overviews for the Durban reference area, not evidence of this
        fictional truck or container. This public reference review is not the gated tenant
        Geospatial workspace, automatic segmentation or damage detection.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
          gap: 16,
        }}
      >
        {scenes.map((s) => (
          <figure key={s.id}>
            <img
              style={{ width: "100%" }}
              src={s.localImage}
              alt={"Sentinel tile overview acquired " + s.acquiredAt}
            />
            <figcaption>
              {s.id}
              <br />
              Acquired {s.acquiredAt}
              <br />
              Scene cloud cover: {s.cloudPercent}%<br />
              {s.credit}.{" "}
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                Source catalogue
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <label>
        Compare image widths
        <input
          aria-label="Comparison width"
          type="range"
          min="25"
          max="75"
          value={side}
          onChange={(e) => setSide(Number(e.target.value))}
        />
      </label>
      <div style={{ display: "flex", width: "100%", overflow: "hidden" }}>
        <img
          alt="First recorded Sentinel overview"
          src={scenes[0].localImage}
          style={{ width: side + "%", objectFit: "contain" }}
        />
        <img
          alt="Second recorded Sentinel overview"
          src={scenes[1].localImage}
          style={{ width: 100 - side + "%", objectFit: "contain" }}
        />
      </div>
      <label>
        Human review note
        <textarea
          style={{ display: "block", width: "100%", minHeight: 90, border: "1px solid #aebec1" }}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved("");
          }}
        />
      </label>
      <button disabled={!note.trim()} onClick={() => setSaved(note)}>
        Keep sample review in browser memory
      </button>
      {saved && (
        <p role="status">
          Unverified sample review retained: {saved}. Not saved to a customer case.
        </p>
      )}
      <p>
        <a href="/sample-geospatial/manifest.json" target="_blank" rel="noreferrer">
          Scene times, source URLs, SHA-256 and limits
        </a>{" "}
        ·{" "}
        <a href={scenes[0].licenseUrl} target="_blank" rel="noreferrer">
          Sentinel legal notice
        </a>
      </p>
      <p>
        No automatic conclusion, georeferenced pixel measurement or historical truck position is
        claimed.
      </p>
    </div>
  );
}
