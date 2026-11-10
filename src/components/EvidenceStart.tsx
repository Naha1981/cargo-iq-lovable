import { Link } from "@tanstack/react-router";
export function EvidenceStart({
  title,
  steps,
  caseId,
  hasDocuments,
}: {
  title: string;
  steps: string[];
  caseId: string;
  hasDocuments: boolean;
}) {
  return (
    <div className="my-4 rounded-xl border bg-secondary/30 p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {!hasDocuments && (
        <Link
          to="/cases/$caseId/documents"
          params={{ caseId }}
          className="mt-4 inline-flex min-h-11 items-center rounded bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Start with a document
        </Link>
      )}
    </div>
  );
}
