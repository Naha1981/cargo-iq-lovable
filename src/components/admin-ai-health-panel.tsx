// Owner admin panel for the in-app AI/extraction health report
// (docs/AI-HEALTH-EMAIL.md, option C). Renders only when a report text exists.
import type { HealthEmailSendRow } from "@/lib/admin.functions";

const NEEDS_REVIEW = new Set(["sending", "send_failed", "unknown"]);

export function AdminAiHealthPanel({
  healthText,
  emailSends = null,
}: {
  healthText: string;
  emailSends?: HealthEmailSendRow[] | null;
}) {
  const flagged = (emailSends ?? []).filter((r) => NEEDS_REVIEW.has(r.status));
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="text-lg font-semibold">Daily AI / extraction health</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Aggregate counts only. No email is sent; this is the in-app owner report
        (docs/AI-HEALTH-EMAIL.md, option C).
      </p>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded border bg-background p-3 text-xs">
        {healthText}
      </pre>
      {emailSends && emailSends.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Health email delivery</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            One row per UTC day. Anything not "sent" is never retried automatically - review it here
            before any manual retry.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {emailSends.map((r) => (
              <li
                key={r.day}
                className={
                  NEEDS_REVIEW.has(r.status)
                    ? "rounded border border-destructive/50 bg-destructive/10 px-2 py-1"
                    : "rounded border px-2 py-1"
                }
              >
                <span className="font-mono">{r.day}</span> - {r.status}
                {NEEDS_REVIEW.has(r.status) && " (needs owner review)"}
                {r.detail ? ` - ${r.detail}` : ""}
              </li>
            ))}
          </ul>
          {flagged.length > 0 && (
            <p className="mt-2 text-xs font-medium text-destructive">
              {flagged.length} day(s) need review. See docs/AI-HEALTH-EMAIL.md before resending: a
              retry is only safe while the Resend idempotency window (24 h from the first attempt)
              is still open or after confirming the provider outcome.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
