import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/client";
import { ensureOrganization } from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signup" } => ({
    mode: search.mode === "signup" ? "signup" : undefined,
  }),
  head: () => ({ meta: [{ title: "CargoIQ — Sign in" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { mode: requestedMode } = Route.useSearch();
  // New customers arrive via "Create an account" (?mode=signup); default stays sign-in.
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(
    requestedMode === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { organization_name: organization || undefined } },
        });
        if (signUpError) throw signUpError;

        if (data.session) await ensureOrganization({ data: { name: organization } });
        if (!data.session) {
          setError("Account created. Check your email to confirm the account, then sign in.");
          setMode("signin");
          return;
        }
      } else if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setError("");
        setNotice(
          "If an account exists for this email, a reset link is on its way. Open it on this device.",
        );
        setMode("signin");
        return;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        await ensureOrganization({ data: { name: organization } });
      }

      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-md">
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CargoIQ</div>
          <h1 className="mt-2 text-3xl font-semibold">Investigative evidence, not guesswork.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Secure case workspaces for freight, port and dispute investigations.
          </p>
        </div>

        <Panel
          title={
            mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create workspace"
                : "Reset password"
          }
        >
          <form className="space-y-4" onSubmit={submit}>
            {mode === "signup" && (
              <label className="block text-sm">
                Organization
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                  placeholder="Acme Logistics"
                />
              </label>
            )}

            <label className="block text-sm">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
              />
            </label>

            {mode !== "reset" && (
              <label className="block text-sm">
                Password
                <input
                  required
                  minLength={8}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
            )}

            {error && (
              <div className="rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded border border-observed/40 bg-observed/10 p-3 text-sm text-observed">
                {notice}
              </div>
            )}
            <Button disabled={busy} className="w-full justify-center">
              {busy
                ? "Working…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create workspace"
                    : "Send reset link"}
            </Button>
          </form>

          {mode === "signin" && (
            <button
              onClick={() => {
                setMode("reset");
                setError("");
                setNotice("");
              }}
              className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
          )}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "Need a workspace? Create one."
              : "Already have an account? Sign in."}
          </button>
        </Panel>
      </div>
      <SiteFooter />
    </div>
  );
}
