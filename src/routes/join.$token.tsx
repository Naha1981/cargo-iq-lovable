import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite, inviteInfo, setActiveWorkspace, friendly } from "@/lib/workspace-client";

export const Route = createFileRoute("/join/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Join a workspace | CargoIQ" }] }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ org_name: string; role: string } | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getSession().then(async ({ data }) => {
      setSignedIn(Boolean(data.session));
      try { setInfo(await inviteInfo(token)); } catch { setInfo(null); }
    });
  }, [token]);

  async function join() {
    setBusy(true); setErr("");
    try { setActiveWorkspace(await acceptInvite(token)); await navigate({ to: "/" }); }
    catch (e) { setErr(friendly(e instanceof Error ? e.message : "Could not join.")); setBusy(false); }
  }

  const label = info?.role === "viewer" ? "viewer (read only)" : "investigator";
  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-md">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CargoIQ</div>
        <h1 className="mt-2 text-3xl font-semibold">Join a workspace</h1>
        <Panel className="mt-8" title={info ? info.org_name : "Invite"}>
          {info === undefined || signedIn === null ? <p className="text-sm text-muted-foreground">Checking the invite…</p> :
           info === null ? <p className="text-sm">This invite link is no longer valid. Ask the workspace admin for a new one.</p> : (
            <>
              <p className="text-sm text-muted-foreground">You have been invited to <strong>{info.org_name}</strong> as {label}.</p>
              {signedIn ? (
                <Button className="mt-4 w-full justify-center" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join workspace"}</Button>
              ) : (
                <Button className="mt-4 w-full justify-center" onClick={() => { window.location.href = `/auth?join=${encodeURIComponent(token)}`; }}>Sign in or create an account to join</Button>
              )}
            </>
          )}
          {err && <div className="mt-3 rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">{err}</div>}
        </Panel>
      </div>
      <SiteFooter />
    </div>
  );
}
