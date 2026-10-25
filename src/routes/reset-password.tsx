import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui-kit";
import { SiteFooter } from "@/components/SiteFooter";
import { createClient } from "@/lib/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "CargoIQ — Reset password" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto max-w-md">
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CargoIQ</div>
          <h1 className="mt-2 text-3xl font-semibold">Choose a new password.</h1>
        </div>
        <Panel title="Reset password">
          {!ready ? (
            <div className="text-sm text-muted-foreground">
              <p>This reset link is invalid or has expired.</p>
              <Link to="/auth" className="mt-3 inline-block text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <label className="block text-sm">
                New password
                <input
                  required
                  minLength={8}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Repeat new password
                <input
                  required
                  minLength={8}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              {error && (
                <div className="rounded border border-disputed/40 bg-disputed/10 p-3 text-sm text-disputed">
                  {error}
                </div>
              )}
              <Button disabled={busy} className="w-full justify-center">
                {busy ? "Working…" : "Save new password"}
              </Button>
            </form>
          )}
        </Panel>
      </div>
      <SiteFooter />
    </div>
  );
}
