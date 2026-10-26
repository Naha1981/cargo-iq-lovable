// Fixture render of the REAL AdminAiHealthPanel component with the REAL
// composeAiHealthText composer output and the app's real stylesheet. This is
// a local pixel proof of layout/styles only - NOT a live authorization or
// data proof (fixture data, no Supabase involved).
import { createRoot } from "react-dom/client";
import { AdminAiHealthPanel } from "@/components/admin-ai-health-panel";
import { composeAiHealthText, type AiHealthReport } from "@/lib/ai-health";
import "@/styles.css";

// Synthetic fixture data, deliberately ordinary: under-cap usage, a couple
// of failures. Nothing here is a claim about production numbers.
const report: AiHealthReport = {
  generated_at: new Date().toISOString(),
  documents_24h: {
    "EXTRACTED|REVIEW:MODEL_RAN": 31,
    "EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout": 2,
  },
  documents_7d: {
    "EXTRACTED|REVIEW:MODEL_RAN": 210,
    "EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout": 9,
    PENDING: 3,
  },
  free_attempts_today: 18,
  app_errors_24h_total: 14,
  app_errors_24h_top_sources: [
    { source: "client", n: 9 },
    { source: "server", n: 5 },
  ],
  latest_document_at: new Date().toISOString(),
  latest_app_error_at: new Date().toISOString(),
};

const text = composeAiHealthText(report, 25);

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-3xl px-6 py-16">
    <h1 className="text-xl font-semibold">Platform overview</h1>
    <div className="mt-6">
      <AdminAiHealthPanel healthText={text} />
    </div>
  </main>,
);
