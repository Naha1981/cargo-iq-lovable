import { useCallback, useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import {
  createInvitation,
  INVITES_NOT_INSTALLED,
  listInvitations,
  revokeInvitation,
  type Invitation,
} from "@/lib/invitations.functions";

export function TeamPanel() {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"investigator" | "viewer" | "admin">("investigator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupPending, setSetupPending] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInvitations(await listInvitations());
      setError("");
      setSetupPending(false);
    } catch (err) {
      if (err instanceof Error && err.message === INVITES_NOT_INSTALLED) {
        setSetupPending(true);
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "Could not load invitations.");
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      if (err instanceof Error && err.message === INVITES_NOT_INSTALLED) setSetupPending(true);
      else setError(err instanceof Error ? err.message : "Could not create the invitation.");
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
            disabled={setupPending}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            placeholder="colleague@company.co.za"
          />
        </label>
        <label className="block text-sm">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            disabled={setupPending}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="investigator">Investigator</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <Button type="submit" disabled={busy || setupPending}>
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
      {setupPending && (
        <div className="mt-3 rounded border border-primary/40 bg-primary/10 p-3 text-sm">
          Team invites are being set up for this workspace. Inviting switches on automatically when
          setup is complete.
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
