import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
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

  // The embedded map's "Open case evidence pack" button navigates in-app,
  // instead of opening a new browser tab that renders blank.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== "harbour-open-pack") return;
      router.navigate({ to: "/cases/$caseId/pack", params: { caseId } });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, caseId]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-primary">LIVE HARBOUR VIEW</div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Real-time vessels off the South African coast. Case evidence stays on the Harbour Map; this is the live outside picture.
          </p>
        </div>
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground">
          Open full page ↗
        </a>
      </div>
      <div className="overflow-hidden rounded-lg border bg-[#061016]">
        <iframe
          src={src}
          title="Live harbour view - real-time vessels off the South African coast"
          allow="microphone"
          className="block h-[calc(100dvh-300px)] min-h-[420px] w-full border-0"
        />
      </div>
    </div>
  );
}
