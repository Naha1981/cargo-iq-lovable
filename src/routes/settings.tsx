import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader, Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { getCurrentUser, deleteOwnAccount } from "@/lib/auth.functions";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type Invitation,
} from "@/lib/invitations.functions";
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
  const { session } = Route.useRouteContext() as {
    session: { user: { email: string } | null; role: string | null };
  };
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

        {session.role === "admin" && <TeamPanel />}

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
          {error && (
            <div className="mt-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">
              {error}
            </div>
          )}
          <div className="mt-4">
            <Button
              disabled={busy || confirmText !== "DELETE"}
              variant="ghost"
              className="border border-disputed/50 text-disputed"
              onClick={deleteAccount}
            >
              {busy ? "Deleting…" : "Delete account and workspace"}
            </Button>
          </div>
        </Panel>
      </main>
      <SiteFooter />
    </div>
  );
}

function TeamPanel() {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"investigator" | "viewer" | "admin">("investigator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newLink, setNewLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setInvitations(await listInvitations());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load invitations.");
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNewLink("");
    try {
      const created = await createInvitation({ data: { email, role } });
      setNewLink(`${window.location.origin}/invite/${created.token}`);
      setEmail("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await revokeInvitation({ data: { invitationId: id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Panel className="mt-6" title="Team">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Invite people to this workspace. You get a link to send them yourself - CargoIQ never emails
        anyone on your behalf. The link only works for the exact email address you invite, once, and
        expires after 7 days.
      </p>
      <form onSubmit={invite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm">
          Work email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            placeholder="colleague@company.co.za"
          />
        </label>
        <label className="block text-sm">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="investigator">Investigator</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Create invite link"}
        </Button>
      </form>
      {newLink && (
        <div className="mt-4 rounded border border-primary/40 bg-primary/10 p-3 text-sm">
          <p className="font-medium">Invite link ready. Send it to that person yourself:</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-background px-2 py-1 text-xs">{newLink}</code>
            <Button type="button" variant="ghost" onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">
          {error}
        </div>
      )}
      {invitations && invitations.length > 0 && (
        <ul className="mt-4 divide-y rounded border text-sm">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span>
                {inv.email} <span className="text-muted-foreground">({inv.role})</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                {inv.accepted_at
                  ? "Accepted"
                  : inv.expired
                    ? "Expired"
                    : `Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                {!inv.accepted_at && !inv.expired && (
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    disabled={busy}
                    className="text-disputed underline underline-offset-2"
                  >
                    Revoke
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
