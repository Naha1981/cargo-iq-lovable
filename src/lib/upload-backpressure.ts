/**
 * Upload-path backpressure: retry-safe, fail-explicit behavior for document
 * uploads (docs/UPLOAD-BACKPRESSURE.md). Pure and config-not-code so the
 * policy is unit-testable without storage.
 */

/** One automatic retry, then the user retries manually. */
export const UPLOAD_MAX_ATTEMPTS = 2;
/** Delay before the automatic retry; mirrors the server's Retry-After. */
export const UPLOAD_RETRY_DELAY_MS = 2000;
/** Window in which a same-content re-upload returns the already-registered row. */
export const UPLOAD_IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1000;

export type UploadErrorLike = {
  statusCode?: string | number | null;
  status?: string | number | null;
  message?: string | null;
};

function statusOf(error: UploadErrorLike): number | null {
  const raw = error.statusCode ?? error.status;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Transient failures are safe to retry once automatically: rate limits and
 * gateway/server faults. The observed burst 403s are NOT here: their
 * causality is unresolved (docs/LOAD-BASELINE.md), and a permanent
 * authorization failure must never be retried as if it were transient.
 */
export function isTransientUploadError(error: unknown): boolean {
  const e = (error ?? {}) as UploadErrorLike;
  const status = statusOf(e);
  if (status != null) return status === 429 || status >= 500;
  return /failed to fetch|network|load failed/i.test(e.message ?? "");
}

/**
 * Exact user-facing contract after a failed automatic retry. A lost response
 * is ambiguous: we cannot claim "nothing was saved", and we do NOT claim
 * retrying is safe - the concurrent same-content window and the
 * reference-check/delete TOCTOU stay open until the owner-gated unique
 * index lands (docs/UPLOAD-BACKPRESSURE.md). The truthful instruction is to
 * check the document list before deciding to retry.
 */
export const UPLOAD_NOT_CONFIRMED_MESSAGE =
  "Upload was not confirmed - the file may not have been saved. Check the document list before retrying.";

/**
 * Exact user-facing contract when the admission semaphore refuses a slot.
 * Truthful by construction: no storage PUT was attempted, so nothing was
 * uploaded and there is nothing to check or clean up.
 */
/** Sentinel thrown client-side when admission refuses a slot (never shown). */
export const UPLOAD_SERVER_BUSY = "UPLOAD_SERVER_BUSY";

export const UPLOAD_SERVER_BUSY_MESSAGE =
  "The server is handling other uploads right now. Wait a moment and try again - your file was not uploaded.";

/**
 * Parse an upload-admission env control. Positive integer = the bound;
 * anything else (unset, empty, invalid, 0) = explicitly unbounded. The
 * per-workspace database override can still disable or re-bind a workspace
 * (migration 20261025220000).
 */
export function parseUploadConcurrency(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Slot lease TTL control: positive seconds, default applied by the caller. */
export function parseUploadSlotTtl(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 30 ? n : fallback;
}
