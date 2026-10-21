import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy policy | CargoIQ" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CargoIQ · NahaLabs</p>
        <h1 className="mt-2 text-3xl font-semibold">Privacy policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Effective 17 October 2026 · Contact: <a className="text-primary hover:underline" href="mailto:sales@nahalabs.co.za">sales@nahalabs.co.za</a></p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-medium">What CargoIQ is</h2>
            <p className="mt-2">CargoIQ is an evidence and dispute-intelligence workspace for freight, port and logistics disputes, operated by NahaLabs, South Africa. Each customer works inside an isolated workspace.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">What we store</h2>
            <p className="mt-2">Your account email and password (passwords are held by our authentication provider, never in plain text), your workspace name, and the case material you upload: documents, extracted claims, timeline events, financial audit runs and evidence packs. Documents you upload are stored with their SHA-256 hash so their integrity can be proven later.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Workspace isolation</h2>
            <p className="mt-2">Your cases and documents are visible only to members of your workspace. Other customers cannot see, search or download your data, and CargoIQ staff access it only when you ask for support or where the law requires it.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">AI processing</h2>
            <p className="mt-2">Claim extraction can use AI models to read documents you upload. Where a free or test AI fallback is used, the app asks for your explicit confirmation first and labels the result. A no-AI text import is always available. AI output is always marked for human review; nothing is verified automatically.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">What we never do</h2>
            <p className="mt-2">We do not sell your data, use your case material to train models, or share it with other customers. Public observations (for example public vessel or terminal data) are always labelled as public corroboration and kept separate from your records.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Your rights</h2>
            <p className="mt-2">You can export your evidence packs at any time. You can delete your account and workspace from the Account page: this removes your cases, documents, claims, packs and login. Under POPIA you may also request access, correction or deletion by emailing <a className="text-primary hover:underline" href="mailto:sales@nahalabs.co.za">sales@nahalabs.co.za</a>.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Security and retention</h2>
            <p className="mt-2">Data is encrypted in transit and at rest. Evidence packs are immutable snapshots: approving a pack never overwrites earlier versions. Deleted accounts are removed from active systems immediately and from backups on the provider's rotation.</p>
          </section>
        </div>
        <Link to="/" className="mt-10 inline-block text-sm text-primary hover:underline">← Back to CargoIQ</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
