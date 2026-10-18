import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader, Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { getCurrentUser, deleteOwnAccount } from "@/lib/auth.functions";
import { TeamPanel } from "@/components/TeamPanel";
import { createClient } from "@/lib/supabase/client";

export const Route = createFileRoute("/settings")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getCurrentUser();
    if (!session.user) throw redirect({ to: "/auth" });
    return { session };
  },
  head: () => ({ meta: [{ title: "Account | CargoIQ" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = Route.useRouteContext() as { session: { user: { id: string; email: string } | null } };
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setBusy(true);
    setError("");
    try {
      await deleteOwnAccount();
      const supabase = createClient();
      await supabase.auth.signOut();
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Account</p>
        <h1 className="mt-2 text-3xl font-semibold">Workspace account</h1>

        <Panel className="mt-8" title="Signed in">
          <p className="text-sm text-muted-foreground">{session.user?.email}</p>
        </Panel>

        {session.user && <TeamPanel myId={session.user.id} />}

        <Panel className="mt-6" title="Delete account">
          <p className="text-sm leading-relaxed text-muted-foreground">
            This permanently deletes your workspace: every case, uploaded document, extracted claim,
            financial audit run and evidence pack, plus your login. It cannot be undone.
          </p>
          <label className="mt-4 block text-sm">
            Type DELETE to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              placeholder="DELETE"
            />
          </label>
          {error && <div className="mt-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">{error}</div>}
          <div className="mt-4">
            <Button disabled={busy || confirmText !== "DELETE"} variant="ghost" className="border border-disputed/50 text-disputed" onClick={deleteAccount}>
              {busy ? "Deleting…" : "Delete account and workspace"}
            </Button>
          </div>
        </Panel>
      </main>
      <SiteFooter />
    </div>
  );
}
