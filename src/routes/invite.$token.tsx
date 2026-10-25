import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader, Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { acceptInvitation } from "@/lib/invitations.functions";

// Accepts a team invitation. The database function enforces every rule: the token
// must be unused and unexpired, and the signed-in user's email must be the invited
// address - a forwarded link grants nothing.
export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Accept invitation | CargoIQ" }] }),
  component: InvitePage,
});

type State =
  | { kind: "working" }
  | { kind: "signed_out" }
  | { kind: "joined" }
  | { kind: "already_member" }
  | { kind: "email_mismatch" }
  | { kind: "invalid_or_expired" }
  | { kind: "error"; message: string };

function InvitePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    let cancelled = false;
    acceptInvitation({ data: { token } })
      .then((r) => {
        if (cancelled) return;
        const status = r.status;
        if (status === "joined" || status === "already_member" || status === "email_mismatch") {
          setState({ kind: status });
        } else {
          setState({ kind: "invalid_or_expired" });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHENTICATED") {
          setState({ kind: "signed_out" });
        } else {
          setState({ kind: "error", message: err instanceof Error ? err.message : "Failed." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen">
      <AppHeader public />
      <main className="mx-auto max-w-xl px-6 py-16">
        <Panel title="Team invitation">
          {state.kind === "working" && (
            <p className="text-sm text-muted-foreground">Accepting your invitation…</p>
          )}
          {state.kind === "signed_out" && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Sign in first with the email address this invitation was sent to, then open this
                link again.
              </p>
              <div className="mt-4">
                <Link to="/auth">
                  <Button>Sign in</Button>
                </Link>
              </div>
            </>
          )}
          {state.kind === "joined" && (
            <>
              <p className="text-sm leading-relaxed">You're in. Your workspace access is ready.</p>
              <div className="mt-4">
                <Link to="/">
                  <Button>Open CargoIQ</Button>
                </Link>
              </div>
            </>
          )}
          {state.kind === "already_member" && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                This account already belongs to that workspace - nothing changed.
              </p>
              <div className="mt-4">
                <Link to="/">
                  <Button>Open CargoIQ</Button>
                </Link>
              </div>
            </>
          )}
          {state.kind === "email_mismatch" && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              This invitation was issued to a different email address. Sign out, sign in with the
              invited address, and open the link again. The invitation has not been used.
            </p>
          )}
          {state.kind === "invalid_or_expired" && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              This invitation link is invalid, already used, or expired. Ask the person who invited
              you for a fresh link.
            </p>
          )}
          {state.kind === "error" && (
            <p className="text-sm leading-relaxed text-disputed">
              Something went wrong: {state.message}
            </p>
          )}
        </Panel>
      </main>
      <SiteFooter />
    </div>
  );
}
