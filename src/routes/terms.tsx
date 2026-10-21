import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of service | CargoIQ" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CargoIQ · NahaLabs</p>
        <h1 className="mt-2 text-3xl font-semibold">Terms of service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Effective 17 October 2026 · Contact: <a className="text-primary hover:underline" href="mailto:sales@nahalabs.co.za">sales@nahalabs.co.za</a></p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-medium">The service</h2>
            <p className="mt-2">CargoIQ, operated by NahaLabs (South Africa), provides an evidence workspace that reconstructs freight, port and logistics disputes from records you provide. It shows what the evidence supports, what it contradicts and what remains uncertain.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">What CargoIQ is not</h2>
            <p className="mt-2">CargoIQ is not legal, financial or claims advice, and it does not decide liability. Calculations follow the commercial rules you enter; the app never estimates or assumes missing values. Parties judge the evidence.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Your responsibilities</h2>
            <p className="mt-2">Upload only records you are authorised to share. Review extracted claims before relying on them: AI extraction is a reading aid, not proof. Keep your login private. Do not use CargoIQ to process data you have no right to hold.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Acceptable use</h2>
            <p className="mt-2">No attempts to access another workspace, disrupt the service, or upload unlawful content. Breaches can lead to account suspension.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Availability and liability</h2>
            <p className="mt-2">The service is provided as is. NahaLabs is not liable for decisions made on unreviewed or unverified outputs, or for indirect losses. Nothing in these terms limits liability that cannot be limited under South African law.</p>
          </section>
          <section>
            <h2 className="text-lg font-medium">Ending the service</h2>
            <p className="mt-2">You can delete your account and workspace at any time from the Account page. We may suspend accounts that breach these terms.</p>
          </section>
        </div>
        <Link to="/" className="mt-10 inline-block text-sm text-primary hover:underline">← Back to CargoIQ</Link>
      </main>
      <SiteFooter />
    </div>
  );
}
