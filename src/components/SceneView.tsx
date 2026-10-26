import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { Tile3DLayer } from "@deck.gl/geo-layers";
import type { Tileset3D } from "@loaders.gl/tiles";
import { Panel, Button } from "@/components/ui-kit";
import {
  listSceneAssets,
  registerSceneAsset,
  requestSceneConversion,
  setSceneTileset,
} from "@/lib/scene.functions";
import {
  SCENE_SOURCE_TYPES,
  isViewable,
  validateTilesetUrl,
  compareSceneCaptures,
} from "@/lib/scene";
import { inspectPlyHeader, type PlyInspection } from "@/lib/ply-validation";
import type { Database } from "@/integrations/supabase/types";

type AssetRow = Database["public"]["Tables"]["scene_assets"]["Row"];

const PLAIN_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }],
} as const;

// Pure presentational 3D Tiles viewer: renders only a real tileset URL.
export function SceneTilesetViewer({ tilesetUrl, name }: { tilesetUrl: string; name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState("Loading candidate tileset metadata...");

  useEffect(() => {
    if (!containerRef.current) return;
    setLoadError(null);
    setLoadState("Loading candidate tileset metadata...");
    let active = true;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: PLAIN_STYLE as never,
      center: [31.02, -29.86],
      zoom: 14,
      pitch: 60,
    });
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    // Tile3DLayer's metadata loader rejects asynchronously without forwarding
    // that rejection to onError. Preflight metadata so failures reach the UI.
    void (async () => {
      try {
        const response = await fetch(tilesetUrl, { signal: abort.signal });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const metadata = await response.json().catch(() => {
          throw new Error("The URL did not return valid tileset JSON");
        });
        if (!metadata?.asset?.version || !metadata?.root)
          throw new Error("Expected 3D Tiles asset version and root metadata");
        if (!active) return;
        setLoadState("Tileset metadata checked. Loading visible tile content...");
        const overlay = new MapLibreOverlay({
          interleaved: true,
          layers: [
            new Tile3DLayer({
              id: "scene-tileset",
              data: tilesetUrl,
              onTilesetLoad: (tileset: Tileset3D) => {
                if (!active) return;
                setLoadState(
                  "Tileset metadata loaded. Waiting for visible tile content; geographic alignment unverified.",
                );
                const c = tileset.cartographicCenter;
                if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                  map.jumpTo({ center: [c[0], c[1]], zoom: tileset.zoom ?? 15, pitch: 60 });
                }
              },
              onTileLoad: () => {
                if (active)
                  setLoadState(
                    "Tile content loaded. Rendering and geographic alignment still require visual review.",
                  );
              },
              onTileError: (_tile, _url, message) => {
                if (active) setLoadError("Tile content failed to load: " + message);
              },
              onError: (e) => {
                if (active) setLoadError("Tileset failed to load: " + e.message);
              },
            }),
          ],
        });
        map.addControl(overlay as never);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(timeout);
      map.remove();
    };
  }, [tilesetUrl]);

  return (
    <div>
      <p className="mb-2 text-xs text-amber-500">
        Candidate tileset URL. Registration does not verify successful rendering, geographic
        placement or Gaussian-splat compatibility.
      </p>
      <p className="mb-2 text-xs text-muted-foreground" role="status">
        {loadError ? "Candidate scene load failed." : loadState}
      </p>
      <div
        ref={containerRef}
        className="h-[420px] w-full rounded border"
        role="application"
        aria-label={"3D scene: " + name}
      />
      {loadError && (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {loadError}. The scene stays registered; check the tileset URL.
        </p>
      )}
    </div>
  );
}

export function ScenePanel({
  initialAssets,
  caseId,
  onRequestConversion,
  caseEvents = [],
  documents = [],
}: {
  initialAssets: AssetRow[];
  caseId: string | null;
  caseEvents?: { id: string; title: string; timestamp: string; source: string | null }[];
  documents?: { id: string; name: string }[];
  /** Test/harness injection point for the conversion request; defaults to the real server function. */
  onRequestConversion?: (assetId: string) => Promise<{ outcome: string; reason?: string }>;
}) {
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [compareId, setCompareId] = useState("");
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>(SCENE_SOURCE_TYPES[0]);
  const [inspection, setInspection] = useState<PlyInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [captureTime, setCaptureTime] = useState("");
  const [provider, setProvider] = useState("");
  const [licence, setLicence] = useState("");
  const [limitations, setLimitations] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [tilesetUrl, setTilesetUrl] = useState("");
  const [attachUrl, setAttachUrl] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const viewable =
    selected && isViewable({ status: selected.status as never, tilesetUrl: selected.tileset_url });

  return (
    <div className="space-y-6">
      <Panel title="3D Scene Intelligence">
        <p className="mb-4 text-xs text-muted-foreground">
          Register photogrammetry/scan assets and view them when a real 3D Tiles tileset exists.
          PLY/LAZ conversion requires an approved converter toolchain; until then conversion
          requests report honestly as unavailable rather than producing fake output.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Register scene asset</h3>
            <label className="block text-xs">
              Inspect PLY header locally (20 MiB maximum, no upload)
              <input
                type="file"
                accept=".ply"
                className="mt-1 block w-full text-xs"
                onChange={async (e) => {
                  setInspection(null);
                  setInspectionError(null);
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setInspection(
                      inspectPlyHeader(
                        new Uint8Array(await f.slice(0, 65536).arrayBuffer()),
                        f.size,
                      ),
                    );
                  } catch (err) {
                    setInspectionError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </label>
            {inspectionError && (
              <p role="alert" className="text-xs text-red-500">
                {inspectionError}
              </p>
            )}
            {inspection && (
              <div className="rounded border p-2 text-xs">
                <p>
                  {inspection.variant} · {inspection.vertices} vertices · {inspection.format}
                </p>
                <ul className="mt-2 list-inside list-disc text-muted-foreground">
                  {inspection.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Scene name (e.g. Durban berth 4 photogrammetry)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="rounded border bg-background px-2 py-1.5 text-sm"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
              >
                {SCENE_SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                placeholder="Source reference (file/object name)"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />
            </div>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs"
              placeholder="Optional: existing 3D Tiles tileset URL (https://.../tileset.json)"
              value={tilesetUrl}
              onChange={(e) => setTilesetUrl(e.target.value)}
            />
            <label className="block text-xs">
              Capture time (local, leave blank if unknown)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border bg-background p-2"
                value={captureTime}
                onChange={(e) => setCaptureTime(e.target.value)}
              />
            </label>
            <input
              className="w-full rounded border bg-background p-2 text-sm"
              placeholder="Provider/source owner"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
            <input
              className="w-full rounded border bg-background p-2 text-sm"
              placeholder="Licence or access terms"
              value={licence}
              onChange={(e) => setLicence(e.target.value)}
            />
            <textarea
              className="w-full rounded border bg-background p-2 text-sm"
              placeholder="Limitations, coordinate system and known placement (do not guess)"
              value={limitations}
              onChange={(e) => setLimitations(e.target.value)}
            />
            <fieldset className="space-y-1 rounded border p-2 text-xs">
              <legend>Associate existing case evidence</legend>
              {caseEvents.length === 0 && documents.length === 0 && (
                <p className="text-muted-foreground">No recorded case events/documents supplied.</p>
              )}
              {caseEvents.map((e) => (
                <label className="block" key={e.id}>
                  <input
                    type="checkbox"
                    checked={eventIds.includes(e.id)}
                    onChange={(x) =>
                      setEventIds((ids) =>
                        x.target.checked ? [...ids, e.id] : ids.filter((id) => id !== e.id),
                      )
                    }
                  />{" "}
                  {e.title} · {new Date(e.timestamp).toLocaleString("en-GB")}
                </label>
              ))}
              {documents.map((d) => (
                <label className="block" key={d.id}>
                  <input
                    type="checkbox"
                    checked={documentIds.includes(d.id)}
                    onChange={(x) =>
                      setDocumentIds((ids) =>
                        x.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id),
                      )
                    }
                  />{" "}
                  Document: {d.name}
                </label>
              ))}
              <p className="text-muted-foreground">
                Association is a reviewer's link, not proof that scene capture shows the linked
                event.
              </p>
            </fieldset>
            <Button
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  if (tilesetUrl.trim()) {
                    const v = validateTilesetUrl(tilesetUrl.trim());
                    if (!v.ok) throw new Error("Tileset URL rejected: " + v.reason);
                  }
                  const row = await registerSceneAsset({
                    data: {
                      caseId: caseId ?? undefined,
                      name: name.trim(),
                      sourceType: sourceType as never,
                      sourceRef: sourceRef.trim() || undefined,
                      tilesetUrl: tilesetUrl.trim() || undefined,
                      eventIds,
                      documentIds,
                      acquiredAt: captureTime ? new Date(captureTime).toISOString() : undefined,
                      provenance: {
                        provider: provider.trim() || undefined,
                        licence: licence.trim() || undefined,
                        limitations: limitations.trim() || undefined,
                      },
                    },
                  });
                  setAssets((a) => [row as AssetRow, ...a]);
                  setName("");
                  setSourceRef("");
                  setTilesetUrl("");
                })
              }
            >
              Register asset
            </Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Registered assets ({assets.length})</h3>
            {assets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No scene assets yet. Register a PLY/LAZ source or an existing 3D Tiles tileset
                above.
              </p>
            )}
            {assets.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="flex justify-between">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.source_type} · {a.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {selected && (
        <Panel title={"Scene: " + selected.name}>
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="font-semibold uppercase">{selected.status}</span>
            <span className="text-muted-foreground">Source type</span>
            <span>{selected.source_type}</span>
            <span className="text-muted-foreground">Source reference</span>
            <span>{selected.source_ref ?? "—"}</span>
            <span className="text-muted-foreground">Captured at</span>
            <span>
              {selected.acquired_at
                ? new Date(selected.acquired_at).toLocaleString("en-GB")
                : "not recorded"}
            </span>
          </div>
          <div className="mb-3 space-y-2 rounded border p-3 text-xs">
            <h4 className="font-semibold">Recorded provenance and associations</h4>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">Provider/source owner</dt>
              <dd>
                {String((selected.provenance as { provider?: string })?.provider || "not recorded")}
              </dd>
              <dt className="text-muted-foreground">Licence/access terms</dt>
              <dd>
                {String((selected.provenance as { licence?: string })?.licence || "not recorded")}
              </dd>
              <dt className="text-muted-foreground">Method</dt>
              <dd>
                {String((selected.provenance as { method?: string })?.method || "not recorded")}
              </dd>
              <dt className="text-muted-foreground">Limitations/placement</dt>
              <dd>
                {String(
                  (selected.provenance as { limitations?: string })?.limitations ||
                    "not recorded - alignment unverified",
                )}
              </dd>
            </dl>
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                Technical record details
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">
                {JSON.stringify(selected.provenance, null, 2)}
              </pre>
            </details>
            <p>Linked case events:</p>
            {caseEvents
              .filter((e) =>
                ((selected.provenance as { caseEventIds?: string[] })?.caseEventIds ?? []).includes(
                  e.id,
                ),
              )
              .map((e) => (
                <p key={e.id}>
                  {e.title} · {e.timestamp} · Source: {e.source ?? "not recorded"}
                </p>
              ))}
            <p>Linked documents:</p>
            {documents
              .filter((d) =>
                ((selected.provenance as { documentIds?: string[] })?.documentIds ?? []).includes(
                  d.id,
                ),
              )
              .map((d) => (
                <a
                  key={d.id}
                  href={`/cases/${caseId}/documents`}
                  className="block text-primary underline"
                >
                  {d.name}
                </a>
              ))}
          </div>
          <label className="mb-3 block text-xs">
            Compare recorded captures
            <select
              className="mt-1 w-full rounded border bg-background p-2"
              value={compareId}
              onChange={(e) => setCompareId(e.target.value)}
            >
              <option value="">Select a second scene</option>
              {assets
                .filter((a) => a.id !== selected.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          {compareId &&
            assets.some((a) => a.id === compareId && a.id !== selected.id) &&
            (() => {
              const other = assets.find((a) => a.id === compareId)!;
              const comparison = compareSceneCaptures(selected, other);
              return (
                <div className="mb-4 rounded border p-3 text-xs">
                  <p>
                    {comparison.label}.{" "}
                    {comparison.gapHours !== null ? comparison.gapHours + " hours apart." : ""}
                  </p>
                  <p className="my-2 text-amber-500">
                    Time order is not change detection. Same coverage, coordinate alignment, capture
                    methods and visibility are unverified. No incident or damage inference is made.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {comparison.ordered.map((a) => (
                      <div key={a.id}>
                        <p className="mb-2 font-semibold">
                          {a.name} · {a.acquired_at ?? "capture time not recorded"}
                        </p>
                        {a.tileset_url ? (
                          <SceneTilesetViewer tilesetUrl={a.tileset_url} name={a.name} />
                        ) : (
                          <p>No candidate tileset URL; visual comparison unavailable.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          {viewable ? (
            <SceneTilesetViewer tilesetUrl={selected.tileset_url!} name={selected.name} />
          ) : (
            <div className="space-y-3 rounded border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                No viewable 3D Tiles output for this asset. Options:
              </p>
              <div className="flex flex-wrap gap-2">
                <p className="w-full text-xs text-amber-500">
                  Conversion unavailable: no approved converter is installed. This action only
                  explains that limitation; it does not start a job.
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = onRequestConversion
                        ? await onRequestConversion(selected.id)
                        : await requestSceneConversion({ data: { assetId: selected.id } });
                      if (r.outcome === "converter_unavailable" && r.reason) setNotice(r.reason);
                    })
                  }
                >
                  Why conversion is unavailable
                </Button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border bg-background px-2 py-1.5 font-mono text-xs"
                  placeholder="Attach existing tileset URL (https://.../tileset.json)"
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                />
                <Button
                  disabled={busy || !attachUrl.trim()}
                  onClick={() =>
                    run(async () => {
                      const updated = await setSceneTileset({
                        data: { assetId: selected.id, tilesetUrl: attachUrl.trim() },
                      });
                      setSelected(updated as AssetRow);
                      setAssets((a) =>
                        a.map((x) => (x.id === selected.id ? (updated as AssetRow) : x)),
                      );
                      setAttachUrl("");
                    })
                  }
                >
                  Attach tileset
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {notice && (
        <p className="text-sm text-amber-500" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SceneView({
  caseId,
  caseEvents = [],
  documents = [],
}: {
  caseId: string;
  caseEvents?: { id: string; title: string; timestamp: string; source: string | null }[];
  documents?: { id: string; name: string }[];
}) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await listSceneAssets({ data: { caseId } });
    setAssets(rows as AssetRow[]);
  }, [caseId]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  if (error)
    return (
      <p className="text-sm text-red-500" role="alert">
        {error}
      </p>
    );
  if (!assets)
    return (
      <div role="status" className="p-10 text-sm text-muted-foreground">
        Loading scene assets...
      </div>
    );
  return (
    <ScenePanel
      initialAssets={assets}
      caseId={caseId}
      caseEvents={caseEvents}
      documents={documents}
    />
  );
}
