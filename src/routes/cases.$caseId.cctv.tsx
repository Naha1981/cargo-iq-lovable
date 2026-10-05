import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button, ClassTag, Panel } from "@/components/ui-kit";
import { createCctvCamera, createCctvSource, getCaseCctv, getCctvEvidenceUrl, linkCctvObservation, reviewCctvObservation } from "@/lib/cctv.functions";

export const Route = createFileRoute("/cases/$caseId/cctv")({
  loader: ({ params }) => getCaseCctv({ data: { caseId: params.caseId } }),
  head: () => ({ meta: [{ title: "CCTV Evidence | CargoIQ" }] }),
  component: CctvPage,
});

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "—";
}
function confidence(value: unknown) {
  return value == null ? "—" : Math.round(Number(value) * 100) + "%";
}

function EvidenceViewer({ caseId, artifactId }: { caseId: string; artifactId: string }) {
  const [state, setState] = useState<{ url: string; sha256: string; mediaType: string; fileName: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getCctvEvidenceUrl({ data: { caseId, artifactId } })
      .then((value) => { if (alive) setState(value); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Could not open evidence."); });
    return () => { alive = false; };
  }, [caseId, artifactId]);
  if (error) return <div className="rounded border border-disputed/40 bg-disputed/5 p-3 text-xs text-disputed">{error}</div>;
  if (!state) return <div className="rounded border bg-panel p-3 text-xs text-muted-foreground">Preparing signed evidence link…</div>;
  return (
    <div className="overflow-hidden rounded-md border bg-black/5">
      {state.mediaType.startsWith("video/") ? <video src={state.url} controls className="max-h-[420px] w-full" /> : <img src={state.url} alt={state.fileName} className="max-h-[420px] w-full object-contain" />}
      <div className="border-t bg-card p-2 font-mono text-[10px] text-muted-foreground break-all">SHA-256 {state.sha256}</div>
    </div>
  );
}

function CctvPage() {
  const { caseId } = Route.useParams();
  const data = Route.useLoaderData();
  const router = useRouter();
  const [sourceName, setSourceName] = useState("");
  const [siteLocation, setSiteLocation] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("REVIEW");
  const [oneTimeSecret, setOneTimeSecret] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [cameraSourceId, setCameraSourceId] = useState(data.sources[0]?.id ?? "");
  const [cameraName, setCameraName] = useState("");
  const [providerCameraId, setProviderCameraId] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);

  const artifactByObservation = useMemo(() => new Map(data.artifacts.map((artifact: any) => [artifact.observation_id, artifact])), [data.artifacts]);
  useEffect(() => { if (!cameraSourceId && data.sources[0]) setCameraSourceId(data.sources[0].id); }, [cameraSourceId, data.sources]);

  async function refresh() { await router.invalidate(); }
  async function addSource() {
    setSourceBusy(true); setSourceMessage(""); setOneTimeSecret("");
    try {
      const result = await createCctvSource({ data: { name: sourceName, siteLocation, licenseStatus } });
      setCameraSourceId(result.source.id); setSourceName(""); setSiteLocation(""); setOneTimeSecret(result.ingestSecret);
      setSourceMessage("Source created. The ingest secret is shown once and is not recoverable from CargoIQ."); await refresh();
    } catch (err) { setSourceMessage(err instanceof Error ? err.message : "Could not create CCTV source."); }
    finally { setSourceBusy(false); }
  }
  async function addCamera() {
    setCameraBusy(true); setCameraMessage("");
    try {
      await createCctvCamera({ data: { sourceId: cameraSourceId, providerCameraId, displayName: cameraName, timezone: "Africa/Johannesburg" } });
      setCameraName(""); setProviderCameraId(""); setCameraMessage("Camera registered."); await refresh();
    } catch (err) { setCameraMessage(err instanceof Error ? err.message : "Could not register camera."); }
    finally { setCameraBusy(false); }
  }
  async function link(id: string) {
    setLinkBusy(id); try { await linkCctvObservation({ data: { caseId, observationId: id } }); await refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : "Could not link observation."); } finally { setLinkBusy(null); }
  }
  async function review(id: string, decision: "CONFIRMED" | "UNCERTAIN" | "REJECTED") {
    setReviewBusy(id); try { await reviewCctvObservation({ data: { caseId, observationId: id, decision } }); await refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : "Could not review observation."); } finally { setReviewBusy(null); }
  }

  return (
    <div className="space-y-6">
      <Panel title="CCTV evidence source">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>CCTV is treated as <strong className="text-foreground">independent visual corroboration</strong>, not an automatic legal conclusion.</p>
            <p className="text-xs">RTSP remains at the customer site. The edge adapter sends event-specific observations and evidence frames or clips to CargoIQ.</p>
            {oneTimeSecret && <div className="rounded-md border border-primary/30 bg-primary/5 p-3"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">One-time edge ingest secret</div><div className="mt-2 break-all rounded bg-card p-2 font-mono text-[11px] text-foreground">{oneTimeSecret}</div><div className="mt-2 text-xs text-muted-foreground">Store it in the edge adapter. CargoIQ stores only an encrypted copy.</div></div>}
            {sourceMessage && <div className="text-xs text-muted-foreground">{sourceMessage}</div>}
          </div>
          <form className="space-y-2 rounded-md border bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void addSource(); }}>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Register source</div>
            <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} required placeholder="Terminal CCTV" className="w-full rounded border bg-card px-3 py-2 text-sm" />
            <input value={siteLocation} onChange={(e) => setSiteLocation(e.target.value)} placeholder="Gate / depot / warehouse" className="w-full rounded border bg-card px-3 py-2 text-sm" />
            <select value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)} className="w-full rounded border bg-card px-3 py-2 text-sm">
              <option value="REVIEW">License review required</option><option value="APPROVED">Approved for use</option><option value="COMMERCIAL_MODEL_LICENSED">Commercial model licensed</option><option value="COMMUNITY_MODEL">Community model</option>
            </select>
            <Button disabled={sourceBusy}>{sourceBusy ? "Creating…" : "Create source"}</Button>
          </form>
        </div>
      </Panel>

      <Panel title={"Camera registry · " + data.cameras.length}>
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <div className="space-y-2">
            {data.cameras.map((camera: any) => <div key={camera.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto]"><div><div className="font-medium">{camera.display_name}</div><div className="mt-1 text-xs text-muted-foreground">provider {camera.provider_camera_id} · {camera.stream_type ?? "stream"} · {camera.installation_location ?? "location not set"}</div></div><div className="text-right text-xs"><div className={camera.health_status === "ONLINE" ? "text-observed" : "text-muted-foreground"}>{camera.health_status}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{formatDate(camera.last_seen_at)}</div></div></div>)}
            {!data.cameras.length && <div className="py-8 text-center text-sm text-muted-foreground">Register the first edge camera below.</div>}
          </div>
          <form className="space-y-2 rounded-md border bg-panel p-3" onSubmit={(e) => { e.preventDefault(); void addCamera(); }}>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Register camera</div>
            <select value={cameraSourceId} onChange={(e) => setCameraSourceId(e.target.value)} required className="w-full rounded border bg-card px-3 py-2 text-sm"><option value="">Select source</option>{data.sources.map((source: any) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
            <input value={cameraName} onChange={(e) => setCameraName(e.target.value)} required placeholder="Gate 04" className="w-full rounded border bg-card px-3 py-2 text-sm" />
            <input value={providerCameraId} onChange={(e) => setProviderCameraId(e.target.value)} required placeholder="Lot Vulture camera ID" className="w-full rounded border bg-card px-3 py-2 text-sm" />
            <Button disabled={cameraBusy || !cameraSourceId}>{cameraBusy ? "Saving…" : "Register camera"}</Button>{cameraMessage && <div className="text-xs text-muted-foreground">{cameraMessage}</div>}
          </form>
        </div>
      </Panel>

      <Panel title={"Observations ready to link · " + data.ready.length}>
        <div className="divide-y">
          {data.ready.map((observation: any) => <div key={observation.id} className="grid gap-3 py-4 lg:grid-cols-[150px_1fr_auto] lg:items-center"><div className="font-mono text-xs text-muted-foreground">{formatDate(observation.observed_at)}</div><div><div className="flex flex-wrap gap-2 items-center"><span className="font-medium">{observation.event_type}</span><ClassTag c={observation.detected_class ?? "object"} /><span className="font-mono text-xs text-muted-foreground">conf {confidence(observation.confidence)}</span>{observation.evidence_available && <span className="rounded bg-observed/10 px-1.5 py-0.5 text-[10px] text-observed">MEDIA HASHED</span>}</div><div className="mt-1 text-xs text-muted-foreground">model {observation.model_name ?? "—"} {observation.model_version ?? ""} · processing {observation.processing_version ?? "—"}</div></div><Button disabled={linkBusy === observation.id} onClick={() => void link(observation.id)}>{linkBusy === observation.id ? "Linking…" : "Link to case"}</Button></div>)}
          {!data.ready.length && <div className="py-10 text-center text-sm text-muted-foreground">No unlinked CCTV observations are currently available for this tenant.</div>}
        </div>
      </Panel>

      <Panel title={"Linked observations · " + data.linked.length}>
        <div className="space-y-4">
          {data.linked.map((observation: any) => {
            const artifact = artifactByObservation.get(observation.id);
            return <article key={observation.id} className="rounded-lg border p-4"><div className="grid gap-4 lg:grid-cols-[1fr_320px]"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-primary">{formatDate(observation.observed_at)}</span><span className="font-medium">{observation.event_type}</span><span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{observation.review_status}</span></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><span className="text-muted-foreground">Confidence</span><div className="font-mono">{confidence(observation.confidence)}</div></div><div><span className="text-muted-foreground">Detected</span><div>{observation.detected_class ?? "vehicle/object"}</div></div><div><span className="text-muted-foreground">Model</span><div>{observation.model_name ?? "—"} {observation.model_version ?? ""}</div></div><div><span className="text-muted-foreground">Processing</span><div className="font-mono">{observation.processing_version ?? "—"}</div></div></div><div className="mt-4 rounded border bg-panel p-3 text-xs text-muted-foreground">This remains an <strong className="text-foreground">INDEPENDENT_OBSERVATION</strong>. CCTV does not establish vehicle identity or legal liability by itself.</div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={reviewBusy === observation.id} onClick={() => void review(observation.id, "CONFIRMED")}>Confirm observation</Button><Button variant="ghost" disabled={reviewBusy === observation.id} onClick={() => void review(observation.id, "UNCERTAIN")}>Mark uncertain</Button><Button variant="ghost" disabled={reviewBusy === observation.id} onClick={() => void review(observation.id, "REJECTED")}>Reject</Button></div></div><div>{artifact ? (openArtifactId === artifact.id ? <EvidenceViewer caseId={caseId} artifactId={artifact.id} /> : <button onClick={() => setOpenArtifactId(artifact.id)} className="w-full rounded border bg-panel p-3 text-left text-xs hover:bg-accent"><div className="font-semibold">Source artefact</div><div className="mt-1 text-muted-foreground">{artifact.file_name} · {Math.round(Number(artifact.byte_size) / 1024)} KB</div><div className="mt-1 font-mono text-[10px] break-all text-muted-foreground">{artifact.sha256_hash}</div><div className="mt-2 text-primary">Open signed evidence viewer →</div></button>) : <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">No source media attached to this observation.</div>}</div></div></article>;
          })}
          {!data.linked.length && <div className="py-10 text-center text-sm text-muted-foreground">Link the first visual observation to add it to this investigation.</div>}
        </div>
      </Panel>
    </div>
  );
}
