/**
 * Daily AI health EMAIL - actual send path (docs/AI-HEALTH-EMAIL.md).
 * Prepared code only: SENDING STAYS DISABLED until the owner grants it.
 * Three independent switches must ALL be present before anything is sent:
 *   CLAIM_HEALTH_EMAIL_ENABLED=1 (explicit enable),
 *   CLAIM_HEALTH_EMAIL_TO (owner-chosen recipient),
 *   RESEND_API_KEY (existing NahaLabs Resend account - no new sign-up,
 *   free tier; no paid AI, no per-send cost claimed here).
 * With any switch missing the function reports exactly why and sends nothing.
 * No scheduler exists yet: wiring a daily trigger (pg_cron or external cron)
 * is a separate owner-approved live change.
 */
import { composeAiHealthText, type AiHealthReport } from "./ai-health";

export type HealthEmailStatus =
  | "disabled"
  | "missing_recipient"
  | "missing_key"
  | "sent"
  | "send_failed"
  | "send_outcome_uncertain";

export function healthEmailConfig(env: {
  CLAIM_HEALTH_EMAIL_ENABLED?: string;
  CLAIM_HEALTH_EMAIL_TO?: string;
  RESEND_API_KEY?: string;
}) {
  return {
    enabled: env.CLAIM_HEALTH_EMAIL_ENABLED === "1",
    to: env.CLAIM_HEALTH_EMAIL_TO?.trim() || null,
    hasKey: Boolean(env.RESEND_API_KEY?.trim()),
  };
}

export function buildHealthEmail(
  report: AiHealthReport,
  dailyCap: number | null,
  to: string,
): { from: string; to: string; subject: string; text: string } {
  const text = composeAiHealthText(report, dailyCap);
  return {
    from: "CargoIQ Health <health@nahalabs.co.za>",
    to,
    subject: "CargoIQ extraction health " + report.generated_at.slice(0, 10) + " (UTC)",
    text,
  };
}

export interface SendOutcome {
  status: "sent" | "send_failed" | "send_outcome_uncertain";
  /** Resend message id when accepted - stored on the day row for audit. */
  messageId?: string;
}

/**
 * Send once through the existing Resend account.
 * `idempotencyKey` goes out as the Resend Idempotency-Key header: resending
 * with the same key within 24h returns the original response WITHOUT sending
 * again. The daily caller keys it to the UTC day so a retry after an
 * ambiguous outcome can never double-send.
 * A provider rejection (4xx) is "send_failed"; a 5xx or a network throw is
 * "send_outcome_uncertain" - the provider may have accepted, and that state
 * must never be silently retried without the idempotency key.
 */
export async function sendDailyAiHealthEmail(
  report: AiHealthReport,
  dailyCap: number | null,
  env: {
    CLAIM_HEALTH_EMAIL_ENABLED?: string;
    CLAIM_HEALTH_EMAIL_TO?: string;
    RESEND_API_KEY?: string;
  },
  opts: { fetchImpl?: typeof fetch; idempotencyKey?: string } = {},
): Promise<SendOutcome> {
  const payload = buildHealthEmail(report, dailyCap, env.CLAIM_HEALTH_EMAIL_TO!.trim());
  const headers: Record<string, string> = {
    Authorization: "Bearer " + env.RESEND_API_KEY,
    "content-type": "application/json",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  try {
    const res = await (opts.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return { status: "sent", messageId: body?.id };
    }
    if (res.status >= 500) return { status: "send_outcome_uncertain" };
    return { status: "send_failed" };
  } catch {
    return { status: "send_outcome_uncertain" };
  }
}

export type HealthInvokeDeps = {
  /** Existing cron-auth: returns a Response failure or null when authorized. */
  authenticate: (request: Request) => Promise<Response | null>;
  /** Atomic day claim (RPC claim_health_email_day): 'claimed' |
   * 'already_sent' | 'in_progress' | 'unknown'. */
  claimDay: (day: string) => Promise<string>;
  completeDay: (day: string, providerMessageId?: string) => Promise<void>;
  failDay: (day: string, detail?: string) => Promise<void>;
  loadReport: () => Promise<AiHealthReport | null>;
  dailyCap: () => number | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type HealthInvokeStatus =
  | HealthEmailStatus
  | "already_sent"
  | "in_progress"
  | "unknown_needs_review"
  | "report_unavailable"
  | "sent_confirmation_failed";

/**
 * One safe scheduled invocation (docs/AI-HEALTH-EMAIL.md). Order matters:
 * the disabled gate answers BEFORE any credential, auth check or DB touch, so
 * pointing a cron at the endpoint before the grant is harmless. When enabled:
 * cron bearer auth, then duplicate-send protection via two bounded rails
 * (NOT an exactly-once guarantee - see docs/AI-HEALTH-EMAIL.md):
 *   1. an atomic DB day-claim (unique day row + bounded lease) - two
 *      concurrent invocations can never both hold the lease;
 *   2. a Resend Idempotency-Key tied to the same day - a retry after an
 *      ambiguous outcome cannot produce a second email.
 * An expired lease, a provider rejection or any unconfirmed outcome is NEVER
 * automatically resent: the day row surfaces as owner-visible for review.
 */
export async function invokeDailyHealthEmail(
  request: Request,
  env: {
    CLAIM_HEALTH_EMAIL_ENABLED?: string;
    CLAIM_HEALTH_EMAIL_TO?: string;
    RESEND_API_KEY?: string;
  },
  deps: HealthInvokeDeps,
): Promise<{ status: HealthInvokeStatus; http: number }> {
  const gate = healthEmailConfig(env);
  if (!gate.enabled) return { status: "disabled", http: 200 };
  const authFailure = await deps.authenticate(request);
  if (authFailure) return { status: "disabled", http: authFailure.status };
  if (!gate.to) return { status: "missing_recipient", http: 200 };
  if (!gate.hasKey) return { status: "missing_key", http: 200 };

  const day = (deps.now?.() ?? new Date()).toISOString().slice(0, 10); // UTC day

  const claim = await deps.claimDay(day);
  if (claim === "already_sent") return { status: "already_sent", http: 200 };
  if (claim === "in_progress") return { status: "in_progress", http: 200 };
  if (claim !== "claimed") {
    // Expired lease / failed send / unknown: never auto-resend, owner reviews.
    return { status: "unknown_needs_review", http: 409 };
  }

  const report = await deps.loadReport();
  if (!report) {
    await deps.failDay(day, "report unavailable");
    return { status: "report_unavailable", http: 502 };
  }

  const outcome = await sendDailyAiHealthEmail(report, deps.dailyCap(), env, {
    fetchImpl: deps.fetchImpl,
    idempotencyKey: "cargoiq-health-email-" + day,
  });
  if (outcome.status === "sent") {
    try {
      await deps.completeDay(day, outcome.messageId);
    } catch {
      // The provider DID accept (and the day idempotency key blocks any
      // same-day duplicate), but the day row still shows 'sending'. Surface
      // this loudly instead of reporting a clean sent: the lease expires and
      // the day then reads unknown for owner review. Cron retries are safe -
      // they answer in_progress/already_sent and send nothing.
      return { status: "sent_confirmation_failed", http: 502 };
    }
    return { status: "sent", http: 200 };
  }
  if (outcome.status === "send_outcome_uncertain") {
    // Lease expires; the day then maps to unknown for owner review. The day
    // idempotency key makes any owner-approved same-day retry safe.
    return { status: "send_outcome_uncertain", http: 502 };
  }
  await deps.failDay(day, "provider rejected the send");
  return { status: "send_failed", http: 502 };
}
