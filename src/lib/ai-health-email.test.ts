import { describe, expect, it, vi } from "vitest";
import {
  buildHealthEmail,
  healthEmailConfig,
  invokeDailyHealthEmail,
  sendDailyAiHealthEmail,
  type HealthInvokeDeps,
} from "./ai-health-email";
import type { AiHealthReport } from "./ai-health";

const report: AiHealthReport = {
  generated_at: "2026-10-25T06:00:00.000Z",
  documents_24h: { "EXTRACTED|REVIEW:MODEL_RAN": 9, "FAILED|MODEL:ERROR": 1 },
  documents_7d: { "EXTRACTED|REVIEW:MODEL_RAN": 20 },
  app_errors_24h_total: 0,
  app_errors_24h_top_sources: [],
  free_attempts_today: 5,
  latest_document_at: "2026-10-25T05:59:00.000Z",
  latest_app_error_at: null,
};

const enabledEnv = {
  CLAIM_HEALTH_EMAIL_ENABLED: "1",
  CLAIM_HEALTH_EMAIL_TO: "owner@nahalabs.co.za",
  RESEND_API_KEY: "re_test",
};

type FetchMock = ReturnType<typeof vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>>;
function okFetch(id = "msg-1"): FetchMock {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));
}

function deps(overrides: Partial<HealthInvokeDeps> = {}): HealthInvokeDeps {
  return {
    authenticate: async () => null,
    claimDay: async () => "claimed",
    completeDay: async () => {},
    failDay: async () => {},
    loadReport: async () => report,
    dailyCap: () => 25,
    fetchImpl: okFetch() as unknown as typeof fetch,
    ...overrides,
  };
}

const req = () => new Request("https://app.test/api/health-email", { method: "POST" });

describe("healthEmailConfig", () => {
  it("requires all three switches", () => {
    expect(healthEmailConfig({}).enabled).toBe(false);
    expect(healthEmailConfig(enabledEnv)).toEqual({
      enabled: true,
      to: "owner@nahalabs.co.za",
      hasKey: true,
    });
  });
});

describe("buildHealthEmail", () => {
  it("builds subject and text from the report", () => {
    const mail = buildHealthEmail(report, 25, "owner@nahalabs.co.za");
    expect(mail.subject).toContain("2026-10-25");
    expect(mail.text).toContain("COMPLETE 9");
    expect(mail.to).toBe("owner@nahalabs.co.za");
  });
});

describe("sendDailyAiHealthEmail", () => {
  it("sends the Idempotency-Key header when given a key", async () => {
    const f = okFetch();
    const out = await sendDailyAiHealthEmail(report, 25, enabledEnv, {
      fetchImpl: f as unknown as typeof fetch,
      idempotencyKey: "cargoiq-health-email-2026-10-25",
    });
    expect(out).toEqual({ status: "sent", messageId: "msg-1" });
    const headers = f.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("cargoiq-health-email-2026-10-25");
  });

  it("provider 4xx is send_failed, 5xx and network errors are uncertain", async () => {
    const f400: FetchMock = vi.fn(async () => new Response("bad", { status: 422 }));
    const f500: FetchMock = vi.fn(async () => new Response("oops", { status: 500 }));
    const fThrow: FetchMock = vi.fn(async () => Promise.reject(new Error("timeout")));
    const opt = (fetchImpl: unknown) => ({ fetchImpl: fetchImpl as typeof fetch });
    expect((await sendDailyAiHealthEmail(report, 25, enabledEnv, opt(f400))).status).toBe(
      "send_failed",
    );
    expect((await sendDailyAiHealthEmail(report, 25, enabledEnv, opt(f500))).status).toBe(
      "send_outcome_uncertain",
    );
    expect((await sendDailyAiHealthEmail(report, 25, enabledEnv, opt(fThrow))).status).toBe(
      "send_outcome_uncertain",
    );
  });
});

describe("invokeDailyHealthEmail", () => {
  it("disabled answers before any auth or DB touch", async () => {
    const authenticate = vi.fn();
    const claimDay = vi.fn();
    const r = await invokeDailyHealthEmail(req(), {}, deps({ authenticate, claimDay }));
    expect(r.status).toBe("disabled");
    expect(authenticate).not.toHaveBeenCalled();
    expect(claimDay).not.toHaveBeenCalled();
  });

  it("auth failure keeps status disabled with the auth http code", async () => {
    const r = await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        authenticate: async () => new Response("nope", { status: 401 }),
      }),
    );
    expect(r).toEqual({ status: "disabled", http: 401 });
  });

  it("already_sent and in_progress claims send nothing", async () => {
    for (const claim of ["already_sent", "in_progress"]) {
      const fetchImpl = okFetch();
      const r = await invokeDailyHealthEmail(
        req(),
        enabledEnv,
        deps({
          claimDay: async () => claim,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );
      expect(r.status).toBe(claim);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("unknown claim (expired lease / prior failure) is NEVER auto-resent", async () => {
    const fetchImpl = okFetch();
    const r = await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        claimDay: async () => "unknown",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(r).toEqual({ status: "unknown_needs_review", http: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("claimed + sent completes the day with the provider message id", async () => {
    const completeDay = vi.fn(async () => {});
    const r = await invokeDailyHealthEmail(req(), enabledEnv, deps({ completeDay }));
    expect(r.status).toBe("sent");
    expect(completeDay).toHaveBeenCalledWith(expect.any(String), "msg-1");
  });

  it("provider rejection fails the day; uncertain outcome leaves the lease to expire", async () => {
    const failDay = vi.fn(async () => {});
    const f400: FetchMock = vi.fn(async () => new Response("bad", { status: 422 }));
    const r1 = await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        failDay,
        fetchImpl: f400 as unknown as typeof fetch,
      }),
    );
    expect(r1.status).toBe("send_failed");
    expect(failDay).toHaveBeenCalledOnce();

    const failDay2 = vi.fn(async () => {});
    const completeDay2 = vi.fn(async () => {});
    const fThrow: FetchMock = vi.fn(async () => Promise.reject(new Error("timeout")));
    const r2 = await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        failDay: failDay2,
        completeDay: completeDay2,
        fetchImpl: fThrow as unknown as typeof fetch,
      }),
    );
    expect(r2.status).toBe("send_outcome_uncertain");
    expect(failDay2).not.toHaveBeenCalled();
    expect(completeDay2).not.toHaveBeenCalled();
  });

  it("mark-after-accept failure is surfaced, not reported as clean sent", async () => {
    const completeDay = vi.fn(async () => {
      throw new Error("db write lost");
    });
    const failDay = vi.fn(async () => {});
    const r = await invokeDailyHealthEmail(req(), enabledEnv, deps({ completeDay, failDay }));
    expect(r).toEqual({ status: "sent_confirmation_failed", http: 502 });
    expect(failDay).not.toHaveBeenCalled();
  });

  it("missing report fails the day as owner-visible", async () => {
    const failDay = vi.fn(async () => {});
    const r = await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        loadReport: async () => null,
        failDay,
      }),
    );
    expect(r.status).toBe("report_unavailable");
    expect(failDay).toHaveBeenCalledOnce();
  });

  it("uses the UTC day for the idempotency key", async () => {
    const f = okFetch();
    await invokeDailyHealthEmail(
      req(),
      enabledEnv,
      deps({
        fetchImpl: f as unknown as typeof fetch,
        now: () => new Date("2026-10-25T23:59:59Z"),
      }),
    );
    const headers = f.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("cargoiq-health-email-2026-10-25");
  });
});
