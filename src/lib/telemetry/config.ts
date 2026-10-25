// Telemetry configuration seam. Kept as its own module so tests can substitute
// it hermetically: import.meta.env is per-module under the vitest transform, so
// a test cannot inject env into this module otherwise.
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

export function getTelemetryConfig(): { apiHost: string; projectToken: string } | null {
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

export function getTelemetryRuntimeEnv(): { mode: string; appVersion?: string } {
  return {
    mode: env.MODE ?? "unknown",
    ...(env.VITE_APP_VERSION ? { appVersion: env.VITE_APP_VERSION } : {}),
  };
}
