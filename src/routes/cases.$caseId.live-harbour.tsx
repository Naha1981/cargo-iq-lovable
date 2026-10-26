import { recoveryRequestKey, clearRecoveryRequest } from "@/lib/recovery-request";
import { HistoricalContributionReview } from "@/components/HistoricalContributionReview";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { saveHistoricalReview } from "@/lib/historical-review.functions";
import { historicalReviewInput } from "@/lib/historical-review";
import { liveHarbourHref } from "@/lib/live-harbour";

export const Route = createFileRoute("/cases/$caseId/live-harbour")({
  head: () => ({ meta: [{ title: "Live Harbour View | CargoIQ" }] }),
  component: LiveHarbourPage,
});

function LiveHarbourPage() {
  const data = CaseRoute.useLoaderData();
  const router = useRouter();
  const base = liveHarbourHref(data.case.port_code);
  const sample = data.case.reference_no === "DUR-2026-0412" ? "1" : "0";
  const src = base + (base.includes("?") ? "&" : "?") + "embed=1&sample=" + sample;
  const caseId = data.case.id as string;
  const [proposal, setProposal] = useState<{
    requestId: string;
    date: string;
    place: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setProposal(null);
    setNotice("");
  }, [caseId]);

  // Repeat the handshake on iframe load so a fast child cannot outrun the effect.
  function requestHistoryBridge() {
    frameRef.current?.contentWindow?.postMessage(
      { type: "cargo-history-request-ready" },
      window.location.origin,
    );
  }

  // The embedded map's "Open case evidence pack" button navigates in-app,
  // instead of opening a new browser tab that renders blank.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin || ev.source !== frameRef.current?.contentWindow)
        return;
      if (ev.data?.type === "cargo-history-ready") {
        ev.source?.postMessage(
          {
            type: "cargo-history-records",
            records: data.timeline.flatMap((e) => {
              const c = e.coordinates as {
                lat?: unknown;
                lon?: unknown;
                latitude?: unknown;
                longitude?: unknown;
              } | null;
              const lat = c?.lat ?? c?.latitude,
                lon = c?.lon ?? c?.longitude;
              return typeof lat === "number" &&
                typeof lon === "number" &&
                Number.isFinite(lat) &&
                Number.isFinite(lon) &&
                Math.abs(lat) <= 90 &&
                Math.abs(lon) <= 180
                ? [
                    {
                      id: e.id,
                      title: e.title,
                      timestamp: e.timestamp,
                      lat,
                      lon,
                      nature: e.nature,
                      source: e.source || "Source not recorded",
                    },
                  ]
                : [];
            }),
          },
          { targetOrigin: window.location.origin },
        );
        return;
      }
      if (ev.data?.type === "cargo-history-contribution") {
        const parsed = historicalReviewInput.safeParse({
          ...ev.data.selection,
          requestId: crypto.randomUUID(),
          caseId,
          confirmed: true,
        });
        if (parsed.success) {
          setProposal(parsed.data);
          setNotice("");
        }
        return;
      }
      if (ev.data?.type !== "harbour-open-pack") return;
      router.navigate({ to: "/cases/$caseId/pack", params: { caseId } });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, caseId, data.timeline]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-primary">
            LIVE HARBOUR VIEW
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Real-time vessels off the South African coast. Case evidence stays on the Harbour Map;
            this is the live outside picture.
          </p>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open full page ↗
        </a>
      </div>
      {proposal && (
        <HistoricalContributionReview
          proposal={proposal}
          saving={saving}
          onConfirm={async () => {
            setSaving(true);
            setNotice("");
            try {
              // Shared opaque operation helper persists only filter digest + UUID.
              // Reload after uncertain response reuses the same request rather than
              // creating duplicate evidence. Case/feature namespace cannot collide.
              const filter = {
                date: proposal.date,
                place: proposal.place,
                lat: proposal.lat,
                lon: proposal.lon,
              };
              const requestId = await recoveryRequestKey(
                sessionStorage,
                "historical:" + caseId,
                filter,
              );
              const result = await saveHistoricalReview({
                data: { ...proposal, requestId, caseId, confirmed: true },
              });
              await clearRecoveryRequest(sessionStorage, "historical:" + caseId, filter);
              setNotice(
                "Saved historical reference review with " +
                  result.recordCount +
                  " recorded case entries. Generate a new pack to freeze this contribution; older packs are unchanged.",
              );
              setProposal(null);
              await router.invalidate();
            } catch (e) {
              setNotice(
                e instanceof Error
                  ? e.message
                  : "Save not confirmed. Check the case before retrying.",
              );
            } finally {
              setSaving(false);
            }
          }}
          onCancel={() => setProposal(null)}
        />
      )}
      {notice && (
        <p role="status" className="rounded border p-3 text-sm">
          {notice}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border bg-[#061016]">
        <iframe
          ref={frameRef}
          onLoad={requestHistoryBridge}
          src={src}
          title="Live harbour view - real-time vessels off the South African coast"
          allow="microphone"
          className="block h-[calc(100dvh-300px)] min-h-[420px] w-full border-0"
        />
      </div>
    </div>
  );
}
