import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { createCase } from "@/lib/case.functions";
import { getCurrentUser } from "@/lib/auth.functions";

export const Route = createFileRoute("/new-case")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getCurrentUser();
    if (!session.user) throw redirect({ to: "/auth" });
  },
  head: () => ({ meta: [{ title: "CargoIQ — New investigation" }] }),
  component: NewCasePage,
});

function NewCasePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    referenceNo: "",
    vesselName: "",
    voyageNo: "",
    containerNo: "",
    portCode: "ZADUR",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const row = await createCase({ data: form });
      await navigate({ to: "/cases/$caseId", params: { caseId: row.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create investigation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">New investigation</p>
      <h1 className="mt-2 text-3xl font-semibold">Start with the shipment facts you know.</h1>

      <Panel className="mt-8">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          {Object.entries(form).map(([key, value]) => (
            <label key={key} className="block text-sm">
              <span className="capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
              <input
                value={value}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 w-full rounded border bg-background px-3 py-2"
                required={key === "referenceNo"}
              />
            </label>
          ))}

          {error && (
            <div className="md:col-span-2 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">
              {error}
            </div>
          )}

          <div className="md:col-span-2 flex justify-end">
            <Button disabled={busy}>{busy ? "Creating…" : "Create investigation"}</Button>
          </div>
        </form>
      </Panel>
    </main>
  );
}
