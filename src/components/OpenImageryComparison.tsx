import { useState, useRef, useEffect } from "react";
import { Panel, Button } from "@/components/ui-kit";
import { searchOpenImagery, loadOpenImageryPreview } from "@/lib/open-imagery.functions";
import { createGeospatialFinding } from "@/lib/gehi.functions";
import { formatImageryDate, type OpenImageryScene } from "@/lib/open-imagery";

export function OpenImageryComparison({
  initialScenes,
  caseId,
  caseLabel,
  location,
  initialDates,
  onSaved,
}: {
  initialScenes?: OpenImageryScene[][];
  initialDates?: [string, string];
  onSaved?: () => Promise<void>;
  caseId: string;
  caseLabel?: string;
  location?: { longitude: number; latitude: number; label: string };
}) {
  const [longitude, setLongitude] = useState(location ? String(location.longitude) : "");
  const [latitude, setLatitude] = useState(location ? String(location.latitude) : "");
  const [dates, setDates] = useState(initialDates ?? ["", ""]);
  const [scenes, setScenes] = useState<OpenImageryScene[][]>(initialScenes ?? [[], []]);
  const [selected, setSelected] = useState(["", ""]);
  const [regions, setRegions] = useState<Record<string, { x: number; y: number }[]>>({});
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retrieved, setRetrieved] = useState("");
  const queryVersion = useRef(0);
  useEffect(() => {
    if (location) {
      queryVersion.current++;
      setLongitude(String(location.longitude));
      setLatitude(String(location.latitude));
      setScenes(initialScenes ?? [[], []]);
      setSelected(["", ""]);
      setRetrieved("");
      setRegions({});
      setNote("");
      setSaved("");
    }
  }, [location, initialScenes]);
  function invalidateQuery() {
    queryVersion.current++;
    setRegions({});
    setNote("");
    setSaved("");
    setScenes([[], []]);
    setSelected(["", ""]);
    setRetrieved("");
    setError("");
  }
  async function choose(i: number, id: string) {
    setSaved("");
    setSelected(selected.map((v, j) => (j === i ? id : v)));
    const scene = scenes[i].find((s) => s.id === id);
    if (!scene || images[id]) return;
    try {
      const result = await loadOpenImageryPreview({ data: { url: scene.previewUrl } });
      setImages((v) => ({ ...v, [id]: result.dataUri }));
    } catch (e) {
      setImageErrors((v) => ({ ...v, [id]: e instanceof Error ? e.message : String(e) }));
    }
  }
  async function saveReview() {
    const pair = scenes.map((list, i) => list.find((s) => s.id === selected[i]));
    if (!pair[0] || !pair[1] || !note.trim()) return;
    const version = queryVersion.current;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const provenance = pair.map((scene) => ({
        sceneId: scene!.id,
        acquiredAt: scene!.acquiredAt,
        sourceUrl: scene!.sourceUrl,
        previewUrl: scene!.previewUrl,
        cloudPercent: scene!.cloudPercent,
        footprint: scene!.footprint,
        crs: scene!.crs,
        transform: scene!.transform,
        shape: scene!.shape,
        roi: regions[scene!.id] || [],
        coordinateSpace: "normalized_preview_image_not_geographic",
        method: "manual_analyst_region_not_AI_segmentation",
      }));
      const rationale = JSON.stringify({
        review: note.trim(),
        selectedReference: { longitude: Number(longitude), latitude: Number(latitude) },
        retrievedAt: retrieved,
        observations: provenance,
      });
      if (rationale.length > 4000)
        throw new Error(
          "Review provenance exceeds the existing finding limit. Use fewer region points and a shorter note.",
        );
      const finding = await createGeospatialFinding({
        data: {
          caseId,
          title: "Manual dated overview review",
          summary: note.trim(),
          latitude: Number(latitude),
          longitude: Number(longitude),
          source: pair.map((s) => s!.sourceUrl).join(" | "),
          method: "Manual two-date Sentinel overview review; no AI segmentation",
          confidence: "unverified",
          rationale,
          observationTime: [pair[0].acquiredAt, pair[1].acquiredAt].sort()[1],
          limitations:
            "Low-resolution overview only; ROI is normalized image space, not georeferenced boundary. Clouds, acquisition differences and alignment can resemble change. No object identity, causation, shipment condition or verified change established.",
        },
      });
      let refreshWarning = "";
      try {
        await onSaved?.();
      } catch {
        refreshWarning =
          " Saved successfully, but refreshing findings failed. Reload the findings before retrying.";
      }
      if (version !== queryVersion.current) return;
      setSaved(
        "Review saved as unverified finding " +
          finding.id +
          ". Reload findings to review its source and rationale." +
          refreshWarning,
      );
    } catch (e) {
      if (version === queryVersion.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    const version = ++queryVersion.current;
    setBusy(true);
    setError("");
    setScenes([[], []]);
    setSelected(["", ""]);
    setRegions({});
    setSaved("");
    setRetrieved("");
    try {
      const results = await Promise.all(
        dates.map((date) =>
          searchOpenImagery({
            data: { caseId, longitude: Number(longitude), latitude: Number(latitude), date },
          }),
        ),
      );
      if (version !== queryVersion.current) return;
      setScenes(results.map((r) => r.scenes));
      setRetrieved(results[0].retrievedAt);
    } catch (e) {
      if (version === queryVersion.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Public dated imagery overview">
      <p className="mb-2 text-xs">
        Case: {caseLabel || "Current investigation"}.{" "}
        {location
          ? "Selected recorded coordinate: " + location.label
          : "Choose a recorded map event or enter a reference coordinate. Coordinates do not verify terminal identity."}
      </p>
      <details className="mb-2 text-xs text-muted-foreground">
        <summary>Technical case identifier</summary>
        {caseId}
      </details>
      <p className="mb-3 text-xs text-muted-foreground">
        Search free Sentinel-2 catalogue for a chosen coordinate and two complete dates. Only scenes
        whose actual footprint contains the coordinate are returned. Public service has no
        availability guarantee. This loads small overview pixels, never the full ~300 MB COG.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Longitude
          <input
            className="block w-full rounded border bg-background p-2 text-foreground"
            disabled={busy}
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => {
              invalidateQuery();
              setLongitude(e.target.value);
            }}
          />
        </label>
        <label className="text-xs">
          Latitude
          <input
            className="block w-full rounded border bg-background p-2 text-foreground"
            disabled={busy}
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => {
              invalidateQuery();
              setLatitude(e.target.value);
            }}
          />
        </label>
        {dates.map((date, i) => (
          <label className="text-xs" key={i}>
            {i === 0 ? "First acquisition day" : "Second acquisition day"}
            <input
              className="block w-full rounded border bg-background p-2 text-foreground"
              disabled={busy}
              type="date"
              value={date}
              onChange={(e) => {
                invalidateQuery();
                setDates(dates.map((v, j) => (j === i ? e.target.value : v)));
              }}
            />
            <span>{formatImageryDate(date)}</span>
          </label>
        ))}
      </div>
      <Button
        className="mt-3"
        disabled={busy || !longitude || !latitude || dates.some((d) => !d)}
        onClick={search}
      >
        {busy ? "Searching public catalogue..." : "Find dated scenes"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {scenes.map((list, i) => (
          <article key={i} className="space-y-2 rounded border p-3 text-xs">
            <label>
              {i === 0 ? "First observation" : "Second observation"}
              <select
                className="block w-full rounded border bg-background p-2 text-foreground"
                disabled={busy}
                value={selected[i]}
                onChange={(e) => void choose(i, e.target.value)}
              >
                <option value="">Select scene ({list.length} available)</option>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
            {list
              .filter((s) => s.id === selected[i])
              .map((s) => (
                <div key={s.id} className="space-y-2">
                  {imageErrors[s.id] && <p role="alert">{imageErrors[s.id]}</p>}
                  {!images[s.id] && !imageErrors[s.id] && <p role="status">Loading overview...</p>}
                  {images[s.id] && (
                    <div className="relative" style={{ position: "relative" }}>
                      <img
                        className="block w-full"
                        src={images[s.id]}
                        alt={"Sentinel overview acquired " + s.acquiredAt}
                        referrerPolicy="no-referrer"
                      />
                      <svg
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          cursor: "crosshair",
                          touchAction: "none",
                        }}
                        aria-label="Mark manual overview region"
                        onClick={(event) => {
                          if (busy) return;
                          setSaved("");
                          const r = event.currentTarget.getBoundingClientRect();
                          const point = {
                            x:
                              Math.round(
                                Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) *
                                  10000,
                              ) / 10000,
                            y:
                              Math.round(
                                Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) *
                                  10000,
                              ) / 10000,
                          };
                          setRegions((v) => ({
                            ...v,
                            [s.id]: [...(v[s.id] || []), point].slice(0, 12),
                          }));
                        }}
                      >
                        <polygon
                          points={(regions[s.id] || []).map((p) => p.x + "," + p.y).join(" ")}
                          fill="rgba(255,180,0,.2)"
                          stroke="#ffb400"
                          strokeWidth=".006"
                        />
                        {(regions[s.id] || []).map((p, j) => (
                          <circle key={j} cx={p.x} cy={p.y} r=".009" fill="#ffb400" />
                        ))}
                      </svg>
                    </div>
                  )}
                  <p>
                    Tap overview to mark an analyst region. This is image-space annotation, NOT a
                    georeferenced boundary or AI mask.
                  </p>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    disabled={busy}
                    onClick={() => {
                      setSaved("");
                      setRegions((v) => ({ ...v, [s.id]: [] }));
                    }}
                  >
                    Clear manual region ({(regions[s.id] || []).length} points)
                  </button>
                  <p>
                    Acquired: {formatImageryDate(s.acquiredAt.slice(0, 10))} at{" "}
                    {s.acquiredAt.slice(11, 19)} UTC
                  </p>
                  <p>Cloud over whole scene: {s.cloudPercent ?? "not recorded"}%</p>
                  <p>
                    Overview: low-resolution thumbnail, NOT a 10 m pixel view. Native source
                    resolution {s.nativeResolutionM} m. No truck/container or damage proof.
                  </p>
                  <p>
                    CRS EPSG:{s.crs}; transform {s.transform.join(", ")}; source shape{" "}
                    {s.shape.join(" x ")}. Overview is not map-aligned analysis imagery.
                  </p>
                  <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                    Provider scene and footprint
                  </a>
                  <p>
                    Copernicus Sentinel data {s.acquiredAt.slice(0, 4)}. Retrieved{" "}
                    {retrieved || "fixture, not authenticated catalogue acceptance"}.
                  </p>
                </div>
              ))}
          </article>
        ))}
      </div>
      <label className="mt-3 block text-xs">
        Analyst review note
        <textarea
          className="mt-1 block w-full rounded border bg-background p-2 text-foreground"
          value={note}
          disabled={busy}
          onChange={(e) => {
            setSaved("");
            setNote(e.target.value);
          }}
          maxLength={1000}
        />
      </label>
      <Button
        disabled={
          busy ||
          !!saved ||
          !note.trim() ||
          selected.some((id) => !id) ||
          selected.some((id) => (regions[id] || []).length < 3)
        }
        onClick={saveReview}
      >
        Save unverified manual review to this case
      </Button>
      {saved && (
        <p role="status" className="mt-2 text-sm">
          {saved}
        </p>
      )}
      <p className="mt-3 text-xs text-amber-600">
        Visual review only. Different cloud, sun angle and sensor conditions can look like change.
        No automated segmentation, aligned pixel comparison, causation or verified finding is
        produced here.
      </p>
    </Panel>
  );
}
