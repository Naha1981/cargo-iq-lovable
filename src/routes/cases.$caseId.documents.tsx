import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button, ClassTag, NatureBadge, Panel } from "@/components/ui-kit";
import { CLAIMS, CONTRADICTIONS, DOCS, type Doc } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/documents")({
  head: () => ({ meta: [{ title: "Documents & contradictions | CargoIQ" }, { name: "description", content: "Extracted claims, provenance and contradiction review." }] }),
  component: DocsPage,
});

function DocsPage() {
  const [docs, setDocs] = useState<Doc[]>(DOCS);
  const [res, setRes] = useState<Record<string, "a" | "b" | undefined>>({});
  const file = useRef<HTMLInputElement>(null);
  const [selDoc, setSelDoc] = useState("DOC-01");
  const [review, setReview] = useState<Record<string, "verified" | "disputed">>({});
  const claims = CLAIMS.filter((c) => c.doc === selDoc);

  const onUpload = (files: FileList | null) => {
    if (!files) return;
    setDocs((d) => [...d, ...Array.from(files).map((f, i) => ({
      id: `DOC-${String(d.length + i + 1).padStart(2, "0")}`, name: f.name, kind: "Pending classification",
      pages: 1, cls: "UNKNOWN" as const, claims: 0, uploaded: new Date().toISOString().slice(0, 10),
    }))]);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Panel title={`Documents · ${docs.length}`} action={
        <><input ref={file} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
          <Button variant="ghost" className="py-1 text-xs" onClick={() => file.current?.click()}>+ Upload</Button></>
      }>
        <ul className="divide-y">
          {docs.map((d) => (
            <li key={d.id} onClick={() => setSelDoc(d.id)} className={cn("-mx-2 flex cursor-pointer items-start gap-3 rounded px-2 py-3 hover:bg-accent", selDoc === d.id && "bg-accent")}>
              <div className="grid h-10 w-8 shrink-0 place-items-center rounded-sm border bg-panel font-mono text-[9px] text-muted-foreground">{d.name.split(".").pop()?.toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{d.id}</span><span>{d.pages}p</span><span>{d.claims} claims</span><ClassTag c={d.cls} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="space-y-4">
        <Panel title={`Extracted claims · ${selDoc}`} action={<span className="font-mono text-xs text-muted-foreground">{Object.keys(review).length}/{CLAIMS.length} reviewed</span>}>
          {claims.length === 0 ? <p className="text-sm text-muted-foreground">Extraction pending for this document.</p> : (
            <ul className="divide-y">{claims.map((c) => {
              const r = review[c.id];
              return (
                <li key={c.id} className="grid items-center gap-3 py-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{c.id} · p.{c.page}</span><NatureBadge n={r === "disputed" ? "disputed" : c.nature} /><ClassTag c={c.cls} />
                      <span className="font-mono">conf {(c.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 text-sm">{c.text}: <span className="font-mono">{c.value}</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setReview({ ...review, [c.id]: "verified" })} className={cn("rounded border px-2.5 py-1 text-xs", r === "verified" ? "border-observed bg-observed/15 text-observed" : "hover:bg-accent")}>Verify</button>
                    <button onClick={() => setReview({ ...review, [c.id]: "disputed" })} className={cn("rounded border px-2.5 py-1 text-xs", r === "disputed" ? "border-disputed bg-disputed/15 text-disputed" : "hover:bg-accent")}>Dispute</button>
                  </div>
                </li>
              );
            })}</ul>
          )}
        </Panel>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contradictions · side-by-side review</h2>
        {CONTRADICTIONS.map((c) => {
          const r = res[c.id];
          return (
            <section key={c.id} className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                  <span className="font-medium">{c.topic}</span>
                </div>
                <span className={cn("rounded px-2 py-0.5 text-xs", c.severity === "High" ? "bg-disputed/15 text-disputed" : "bg-derived/15 text-derived")}>{c.severity}</span>
              </header>
              <div className="grid md:grid-cols-[1fr_auto_1fr]">
                {(["a", "b"] as const).map((k, i) => {
                  const s = c[k];
                  return [
                    i === 1 && <div key="vs" className="hidden items-center px-2 font-mono text-xs text-disputed md:flex">≠</div>,
                    <button key={k} onClick={() => setRes({ ...res, [c.id]: k })}
                      className={cn("m-3 rounded-md border p-4 text-left transition-colors hover:bg-accent", r === k && "border-observed bg-observed/5", r && r !== k && "opacity-50")}>
                      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{s.source}</span><NatureBadge n={s.nature} /></div>
                      <div className="mt-2 font-mono text-lg">{s.value}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{s.ref}</div>
                    </button>,
                  ];
                })}
              </div>
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">{c.impact}</span>
                <span className={cn("font-mono text-xs", r ? "text-observed" : "text-derived")}>
                  {r ? `Resolved → ${c[r].source}` : "Awaiting reviewer decision"}
                </span>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
