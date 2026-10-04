import {
  TELEMETRY_PRODUCT,
  type TelemetryEventName,
  type TelemetryPayload,
} from "./events";
import { sanitizeTelemetry } from "./sanitizer";

type TelemetryEnvironment = ImportMeta & {
  env?: {
    MODE?: string;
    DEV?: boolean;
    VITE_POSTHOG_PROJECT_TOKEN?: string;
    VITE_POSTHOG_HOST?: string;
    VITE_APP_VERSION?: string;
  };
};

const env = (import.meta as TelemetryEnvironment).env ?? {};
const DEFAULT_STORAGE_KEY = `nahalabs.telemetry.subject.${TELEMETRY_PRODUCT.toLowerCase()}`;

let anonymousSubjectId: string | null = null;
let initialized = false;

function getConfig(): { apiHost: string; projectToken: string } | null {
  const projectToken = env.VITE_POSTHOG_PROJECT_TOKEN?.trim() ?? "";
  const apiHost = env.VITE_POSTHOG_HOST?.trim().replace(/\/+$/, "") ?? "";

  if (!projectToken || !apiHost || typeof window === "undefined") {
    return null;
  }

  try {
    const parsed = new URL(apiHost);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return { apiHost: parsed.toString().replace(/\/+$/, ""), projectToken };
  } catch {
    return null;
  }
}

function getAnonymousSubjectId(): string {
  if (anonymousSubjectId) return anonymousSubjectId;

  if (typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem(DEFAULT_STORAGE_KEY);
      if (stored) {
        anonymousSubjectId = stored;
        return stored;
      }
    } catch {
      // Storage is best-effort only.
    }
  }

  anonymousSubjectId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `anon_${Math.random().toString(36).slice(2)}`;

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(DEFAULT_STORAGE_KEY, anonymousSubjectId);
    } catch {
      // Storage is best-effort only.
    }
  }

  return anonymousSubjectId;
}

export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  if (!getConfig()) return;

  void captureTelemetry("app_opened", {
    product: TELEMETRY_PRODUCT,
    environment: env.MODE ?? "unknown",
    ...(env.VITE_APP_VERSION ? { app_version: env.VITE_APP_VERSION } : {}),
    platform: "web",
  });
}

export function captureTelemetry<E extends TelemetryEventName>(
  eventName: E,
  properties: TelemetryPayload<E>,
): void {
  const config = getConfig();
  if (!config) return;

  const sanitized = sanitizeTelemetry(eventName, properties as Record<string, unknown>);
  if (!sanitized) return;

  const body = JSON.stringify({
    api_key: config.projectToken,
    event: sanitized.eventName,
    distinct_id: getAnonymousSubjectId(),
    properties: {
      ...sanitized.properties,
      "$process_person_profile": false,
    },
  });

  void fetch(`${config.apiHost}/i/v0/e/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    keepalive: true,
  }).catch(() => {
    // Telemetry is best-effort. Product and operational workflows never depend on it.
  });
}
