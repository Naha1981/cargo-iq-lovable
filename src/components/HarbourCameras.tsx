import { useEffect, useRef, useState } from "react";

export const HARBOUR_CAMERAS = [
  {
    id: "marina",
    name: "Durban harbour entrance",
    title: "PYC Marina",
    url: "https://restreamer.cd.net.za/c1b53a50-06bb-47da-916a-01fb19d5c547.html",
  },
  {
    id: "beach",
    name: "Durban beachfront",
    title: "PYC Beach",
    url: "https://restreamer.cd.net.za/7bd8fb34-74b3-4158-abc0-06fbbc8ffb2b.html",
  },
] as const;

export function HarbourCameras() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const camera = HARBOUR_CAMERAS[selected];
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const nodes = [
          ...(closeRef.current
            ?.closest("section")
            ?.querySelectorAll<HTMLElement>("button,select,a[href],iframe") ?? []),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
      trigger?.focus();
    };
  }, [open]);
  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    if (!open) return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [open, selected, reload]);
  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="min-h-11 rounded border border-primary/50 bg-card px-4 text-sm font-semibold text-primary"
      >
        Cameras
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-3"
          onClick={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="harbour-camera-title"
            className="max-h-[calc(100dvh-24px)] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card p-4 text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="harbour-camera-title" className="text-xl font-semibold">
                  Durban cameras
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  See the harbour entrance or beachfront now.
                </p>
              </div>
              <button
                ref={closeRef}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded border px-4 text-sm"
              >
                Close
              </button>
            </div>
            <label className="mt-4 block text-sm font-medium" htmlFor="harbour-camera-choice">
              Choose a view
            </label>
            <select
              id="harbour-camera-choice"
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded border bg-background px-3 text-sm"
            >
              {HARBOUR_CAMERAS.map((c, i) => (
                <option key={c.id} value={i}>
                  {c.name}
                </option>
              ))}
            </select>
            <iframe
              key={camera.id + reload}
              src={camera.url}
              title={camera.name + " public player"}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoaded(true)}
              className="mt-3 aspect-video min-h-52 w-full rounded border bg-black"
            />
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {slow
                ? "If the picture is blank or stalled, reload it or open the provider player."
                : loaded
                  ? "Provider player loaded. Press its Play button if needed."
                  : "Loading the provider player..."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Public outside view, not footage of this shipment or its disputed date. No video is
              saved to your evidence pack.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setReload((n) => n + 1)}
                className="min-h-11 rounded border px-3 text-sm"
              >
                Reload camera
              </button>
              <a
                href={camera.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center rounded border px-3 text-sm"
              >
                Open provider player
              </a>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {camera.title} · Point Yacht Club · CC BY 4.0. Feed timing and availability are
              controlled by the provider. Camera position is approximate.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
