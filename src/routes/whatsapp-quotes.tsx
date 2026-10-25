import { createFileRoute, useRouter } from "@tanstack/react-router";
import { WhatsAppQuoteAdmin } from "@/components/WhatsAppQuoteAdmin";
import { loadQuoteAdmin, importQuoteCsv, simulateQuote, revokeQuoteBatch } from "@/lib/whatsapp/admin.functions";

function QuoteSetupUnavailable({ error }: { error: unknown }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Quote setup unavailable</h1>
      <p className="mt-3 text-sm">Tenant admin access and the staged WhatsApp foundation schema are required. Nothing was sent.</p>
      <p className="mt-3 text-xs">{error instanceof Error ? error.message : "Request failed"}</p>
    </main>
  );
}

function WhatsAppQuotesPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  return (
    <WhatsAppQuoteAdmin
      rates={data.rates}
      onImport={(csv) => importQuoteCsv({ data: { csv } })}
      onSimulate={(text) => simulateQuote({ data: { text } })}
      onRevoke={(batchId, reason) => revokeQuoteBatch({ data: { batchId, reason } })}
      onReload={() => void router.invalidate()}
    />
  );
}

export const Route = createFileRoute("/whatsapp-quotes")({
  ssr: false,
  loader: () => loadQuoteAdmin(),
  head: () => ({ meta: [{ title: "WhatsApp quote setup | CargoIQ" }, { name: "robots", content: "noindex,nofollow" }] }),
  errorComponent: QuoteSetupUnavailable,
  component: WhatsAppQuotesPage,
});
