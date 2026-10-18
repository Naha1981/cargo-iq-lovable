import { useCallback, useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import {
  activeWorkspaceId, createInvite, createWorkspace, currentInvite, inviteUrl, listMembers, listWorkspaces,
  removeMember, revokeInvite, setActiveWorkspace, setMemberRole, friendly, type Member, type Workspace,
} from "@/lib/workspace-client";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", investigator: "Investigator", viewer: "Viewer (read only)" };

export function WorkspaceSwitcher() {
  const [list, setList] = useState<Workspace[]>([]);
  useEffect(() => { listWorkspaces().then(setList).catch(() => undefined); }, []);
  if (list.length < 2) return null;
  const current = list.find((w) => w.tenant_id === activeWorkspaceId())?.tenant_id ?? list[0]!.tenant_id;
  return (
    <select
      aria-label="Switch workspace"
      value={current}
      onChange={(e) => { setActiveWorkspace(e.target.value); window.location.href = "/"; }}
      className="max-w-[9rem] truncate rounded border bg-secondary px-2 py-1 text-xs text-foreground"
    >
      {list.map((w) => <option key={w.tenant_id} value={w.tenant_id}>{w.name}</option>)}
    </select>
  );
}

export function TeamPanel({ myId }: { myId: string }) {
  const [list, setList] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState<{ token: string; role: string } | null>(null);
  const [role, setRole] = useState("investigator");
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const active = list.find((w) => w.tenant_id === activeWorkspaceId()) ?? list[0];
  const isAdmin = active?.role === "admin";

  const load = useCallback(async () => {
    try {
      const ws = await listWorkspaces();
      setList(ws);
      const cur = ws.find((w) => w.tenant_id === activeWorkspaceId()) ?? ws[0];
      if (!cur) return;
      setMembers(await listMembers(cur.tenant_id));
      setInvite(cur.role === "admin" ? await currentInvite(cur.tenant_id) : null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the team."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok = "") {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); setMsg(ok); await load(); } catch (e) { setErr(e instanceof Error ? friendly(e.message) : "Something went wrong."); }
    setBusy(false);
  }

  if (!active) return null;
  return (
    <>
      <Panel className="mt-6" title={`Team: ${active.name}`}>
        <p className="text-sm text-muted-foreground">
          You are <strong>{ROLE_LABEL[active.role]}</strong> in this workspace. Everyone here sees the same cases.
          Nobody outside it can.
        </p>
        <ul className="mt-4 divide-y rounded-md border text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 break-all">{m.email}{m.user_id === myId ? " (you)" : ""}</span>
              {isAdmin ? (
                <span className="flex items-center gap-2">
                  <select aria-label={`Role for ${m.email}`} value={m.role} disabled={busy}
                    onChange={(e) => run(() => setMemberRole(active.tenant_id, m.user_id, e.target.value))}
                    className="rounded border bg-background px-2 py-1 text-xs">
                    <option value="admin">Admin</option><option value="investigator">Investigator</option><option value="viewer">Viewer</option>
                  </select>
                  {m.user_id !== myId && (
                    <button disabled={busy} className="text-xs text-disputed underline" onClick={() => run(() => removeMember(active.tenant_id, m.user_id), "Member removed.")}>Remove</button>
                  )}
                </span>
              ) : <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-medium">Invite link</p>
            {invite ? (
              <>
                <input readOnly value={inviteUrl(invite.token)} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border bg-background px-3 py-2 text-xs" />
                <p className="text-xs text-muted-foreground">Joins as {ROLE_LABEL[invite.role]}. Valid for 14 days. Anyone with the link can join, so share it with your team only.</p>
                <div className="flex gap-2">
                  <Button disabled={busy} variant="ghost" className="border" onClick={() => navigator.clipboard?.writeText(inviteUrl(invite.token)).then(() => setMsg("Link copied."))}>Copy link</Button>
                  <Button disabled={busy} variant="ghost" className="border" onClick={() => run(() => revokeInvite(active.tenant_id), "Link switched off.")}>Switch off</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Role for the invite link" value={role} onChange={(e) => setRole(e.target.value)} className="rounded border bg-background px-2 py-2 text-xs">
                  <option value="investigator">Investigator</option><option value="viewer">Viewer (read only)</option>
                </select>
                <Button disabled={busy} onClick={() => run(() => createInvite(active.tenant_id, role), "Invite link created.")}>Create invite link</Button>
              </div>
            )}
          </div>
        )}
        {!isAdmin && members.length > 0 && (
          <div className="mt-4">
            <Button disabled={busy} variant="ghost" className="border" onClick={() => run(async () => { await removeMember(active.tenant_id, myId); window.location.href = "/"; })}>Leave this workspace</Button>
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-primary">{msg}</p>}
        {err && <div className="mt-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">{err}</div>}
      </Panel>

      <Panel className="mt-6" title="Your workspaces">
        <ul className="text-sm">
          {list.map((w) => (
            <li key={w.tenant_id} className="flex items-center justify-between py-1">
              <span>{w.name} <span className="text-xs text-muted-foreground">({w.role})</span></span>
              {w.tenant_id === active.tenant_id ? <span className="text-xs text-primary">Active</span> :
                <button className="text-xs underline" onClick={() => { setActiveWorkspace(w.tenant_id); window.location.reload(); }}>Switch</button>}
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return;
          run(async () => { const id = await createWorkspace(newName.trim()); setActiveWorkspace(id); window.location.href = "/"; }); }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New workspace name" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
          <Button disabled={busy || !newName.trim()}>Create workspace</Button>
        </form>
      </Panel>
    </>
  );
}
