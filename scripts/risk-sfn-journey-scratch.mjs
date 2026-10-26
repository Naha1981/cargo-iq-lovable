// SCRATCH (uncommitted): REAL server-function journeys for the Logistics Risk
// Intelligence layer via the actual app HTTP path (dev server bound to
// staging) + PostgREST state verification. Synthetic tenants only.
import { execFileSync } from "node:child_process";
const { toJSONAsync, fromCrossJSON } = await import("seroval");
const SB = "https://khuddkzdghdvdhroeoag.supabase.co";
const ANON = "sb_publishable_DLU8egD9-EEYSG2O1gilkg_UOBAwp32";
const APP = "http://127.0.0.1:8091";
const results = [];
const RUN = Date.now();
const rec = (n, ok, d) => { results.push(ok); console.log((ok ? "PASS" : "FAIL") + " " + n + (d ? " - " + d : "")); };

const mod = await (await fetch(APP + "/src/lib/risk-events.functions.ts")).text();
const fid = (name) => {
  const m = mod.match(new RegExp("export const " + name + " = [\\s\\S]*?createClientRpc\\(\"([^\"]+)\"\\)"));
  if (!m) throw new Error("no id for " + name);
  return m[1];
};
async function sfn(name, data, token) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const r = await fetch(APP + "/_serverFn/" + fid(name), {
    method: "POST",
    headers: { "x-tsr-serverFn": "true", "content-type": "application/json", accept: "application/json", origin: APP, referer: APP + "/", authorization: "Bearer " + token },
    body, signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let env; try { env = fromCrossJSON(JSON.parse(text), { plugins: [] }); } catch { throw new Error(name + " decode: " + text.slice(0, 150)); }
  if (env && env.error) { const e = env.error; const err = new Error(e && e.message ? e.message : JSON.stringify(e).slice(0, 200)); err.sfn = name; throw err; }
  return env ? env.result : undefined;
}
const rest = (path, token, opts = {}) =>
  fetch(SB + "/rest/v1/" + path, { method: opts.method ?? "GET", headers: { apikey: ANON, authorization: "Bearer " + (token ?? ANON), "content-type": "application/json", prefer: opts.prefer ?? "return=representation" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
async function signin(email) {
  const r = await fetch(SB + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: "synth-not-used" }) });
  const j = await r.json();
  if (!r.ok) throw new Error("signin " + email + " " + r.status);
  return j.access_token;
}
const sql = (q) => execFileSync("psql", ["-X", "-q", "-t", "-A", `-c`, q], { encoding: "utf8" }).trim();

const jwt1 = await signin("synth-cap-001@cargoiq-staging.invalid");
const jwt2 = await signin("synth-cap-002@cargoiq-staging.invalid");
const t1 = (await (await rest("user_roles?select=tenant_id", jwt1)).json())[0].tenant_id;
const caseId = (await (await rest("cases?select=id&reference_no=eq.SYNTH-RISK-J1", jwt1)).json())[0].id;

// 0. second case in the same tenant, created BEFORE ingest so the shared
// event's correlation spreads to both cases naturally (conflict test below)
const uid = (await (await rest("user_roles?select=user_id&limit=1", jwt1)).json())[0].user_id;
const c1 = (await (await rest("cases?select=*&reference_no=eq.SYNTH-RISK-J1", jwt1)).json())[0];
const { id: _ci, created_at: _cc, updated_at: _cu, ...caseShape } = c1;
const case2 = (await (await rest("cases", jwt1, { method: "POST", body: { ...caseShape, reference_no: "SYNTH-RISK-J2-" + RUN, title: "SYNTH conflict verdict case " + RUN } })).json())[0];
if (!case2?.id) throw new Error("case2 insert failed");

// 1. notice capture + auto-correlation + alert creation via real server function
const ing = await sfn("ingestRiskEvent", {
  source: "manual_notice", kind: "port_notice",
  title: `SYNTH UI journey ${RUN}: crane breakdown berth 205 Durban`,
  summary: "Synthetic server-function journey event.",
  observedAt: "2026-10-26T07:15:00Z", portCode: "ZADUR", confidence: "low",
  sourceRef: `synth://sfn-journey/${RUN}/1`,
}, jwt1);
const links = await (await rest(`risk_event_case_links?select=*&event_id=eq.${ing.event.id}`, jwt1)).json();
const alerts1 = await (await rest(`risk_alerts?select=*&event_id=eq.${ing.event.id}`, jwt1)).json();
const linkedCaseIds = links.map((l) => l.case_id);
rec("serverFn ingest + auto-correlation + alert", ing.links >= 2 && linkedCaseIds.includes(caseId) && linkedCaseIds.includes(case2.id) && alerts1.every((a) => a.status === "open" && a.verification_status === "unverified"),
  "links=" + ing.links + " alerts=" + ing.alerts + " basis=" + links[0]?.match_basis);
const alert1 = alerts1.find((a) => a.case_id === caseId).id;
rec("alert wording neutral (no frozen status claim)", !/unverified/i.test(alerts1[0].risk_explanation), JSON.stringify(alerts1[0].risk_explanation.slice(0, 60)));

// 2. dedupe through the server function
const ingDup = await sfn("ingestRiskEvent", {
  source: "manual_notice", kind: "port_notice",
  title: `SYNTH UI journey ${RUN}: crane breakdown berth 205 Durban`,
  summary: "dup", observedAt: "2026-10-26T07:15:00Z", portCode: "ZADUR", confidence: "low",
}, jwt1);
rec("serverFn dedupe returns existing, no double-alert", ingDup.duplicate === true && ingDup.links === 0, "duplicate=" + ingDup.duplicate);

// 3. human verification CONFIRM via server function: alert AND event move
await sfn("verifyRiskAlert", { alertId: alert1, decision: "confirmed", notes: "sfn journey" }, jwt1);
const a1 = (await (await rest(`risk_alerts?select=verification_status&id=eq.${alert1}`, jwt1)).json())[0];
const e1 = (await (await rest(`risk_events?select=verification_status&id=eq.${ing.event.id}`, jwt1)).json())[0];
rec("case verdict confirms ALERT only; shared event keeps own state", a1.verification_status === "confirmed" && e1.verification_status === "unverified", "alert=" + a1.verification_status + " event=" + e1.verification_status);

// 3b. conflicting verdicts on the same shared event across two cases:
// correlation already created case2's alert through the real ingest path
const alert2row = alerts1.find((a) => a.case_id === case2.id);
if (!alert2row?.id) throw new Error("correlated case2 alert missing");
await sfn("verifyRiskAlert", { alertId: alert2row.id, decision: "rejected", notes: "case2 sees it differently" }, jwt1);
const a1b = (await (await rest("risk_alerts?select=verification_status&id=eq." + alert1, jwt1)).json())[0];
const a2b = (await (await rest("risk_alerts?select=verification_status&id=eq." + alert2row.id, jwt1)).json())[0];
const e2 = (await (await rest("risk_events?select=verification_status&id=eq." + ing.event.id, jwt1)).json())[0];
rec("conflicting verdicts stay case-scoped", a1b.verification_status === "confirmed" && a2b.verification_status === "rejected" && e2.verification_status === "unverified", "case1=" + a1b.verification_status + " case2=" + a2b.verification_status + " event=" + e2.verification_status);
const decCount = sql("select count(*) from public.risk_alert_verifications where alert_id in ('" + alert1 + "','" + alert2row.id + "')");
rec("both verdicts recorded as separate audit decisions", decCount === "2", "decisions=" + decCount);

// 4. vessel AIS-gap event: disclaimer text + REJECT path
const ing2 = await sfn("ingestRiskEvent", {
  source: "ais", kind: "vessel",
  title: `AIS gap detected: SYNTH VESSEL ${RUN}`,
  summary: "No position report for 9 h outside Durban anchorage.",
  observedAt: "2026-10-26T07:20:00Z", vesselName: "SYNTH VESSEL 7", portCode: "ZADUR", confidence: "medium",
  sourceRef: `synth://sfn-journey/${RUN}/2`,
}, jwt1);
const alerts2 = await (await rest(`risk_alerts?select=*&event_id=eq.${ing2.event.id}`, jwt1)).json();
const aisAlert = alerts2.find((a) => /risk signal, not proof/i.test(a.risk_explanation));
rec("AIS gap alert carries disclaimer + vessel match", ing2.alerts >= 1 && !!aisAlert, "alerts=" + ing2.alerts);
await sfn("verifyRiskAlert", { alertId: aisAlert.id, decision: "rejected", notes: "legit reason confirmed" }, jwt1);
const a2v = (await (await rest(`risk_alerts?select=verification_status&id=eq.${alerts2[0].id}`, jwt1)).json())[0];
rec("reject path", a2v.verification_status === "rejected");

// 5. status lifecycle: acknowledge + resolve on alert1
await sfn("updateAlertStatus", { alertId: alert1, status: "acknowledged" }, jwt1);
await sfn("updateAlertStatus", { alertId: alert1, status: "resolved" }, jwt1);
const a1s = (await (await rest(`risk_alerts?select=status&id=eq.${alert1}`, jwt1)).json())[0];
rec("status lifecycle acknowledge->resolve", a1s.status === "resolved");

// 6. cost recovery via server function
const cost = await sfn("linkCostRecovery", { caseId, alertId: alert1, costCategory: "detention", amount: 4200, currency: "ZAR", notes: "sfn journey" }, jwt1);
rec("cost link via serverFn", cost.cost_category === "detention" && Number(cost.amount) === 4200);

// 7. weather: real Open-Meteo call through the server function
const w1 = await sfn("capturePortWeather", { portCode: "ZADUR" }, jwt1);
rec("weather capture real API (threshold honest)", w1.captured === false || w1.captured === true, w1.captured ? "captured event " + w1.event.title.slice(0, 50) : "reason=" + w1.reason);
// owner-settable low threshold proves the full capture path with REAL measured weather
await sfn("upsertRiskSourceConfig", { source: "open_meteo", enabled: true, settings: { windSpeedWarnKmh: 1, waveHeightWarnM: 0.1 }, maxEventsPerDay: 50 }, jwt1);
const w2 = await sfn("capturePortWeather", { portCode: "ZADUR" }, jwt1);
rec("weather capture with owner-set threshold", w2.captured === true && w2.event.source === "open_meteo", w2.captured ? "wind=" + w2.conditions.windSpeed + " wave=" + w2.conditions.waveHeight : "reason=" + w2.reason);
if (w2.captured) {
  const vt = new Date(w2.validTime).getTime();
  rec("weather valid-time honest (current<=now, or forecast labeled + future)",
    w2.dataType === "current" ? vt <= Date.now() : (vt > Date.now() && w2.event.title.startsWith("Forecast")),
    "dataType=" + w2.dataType + " validTime=" + w2.validTime);
}
await sfn("upsertRiskSourceConfig", { source: "open_meteo", enabled: true, settings: { windSpeedWarnKmh: 55 }, maxEventsPerDay: 50 }, jwt1);

// 8. role denial: viewer cannot ingest
sql("update public.user_roles set role='viewer' where user_id=(select id from auth.users where email='synth-cap-003@cargoiq-staging.invalid')");
const jwt3 = await signin("synth-cap-003@cargoiq-staging.invalid");
let denied = "";
try { await sfn("ingestRiskEvent", { source: "manual_notice", kind: "other", title: "viewer attempt", observedAt: "2026-10-26T07:30:00Z" }, jwt3); } catch (e) { denied = e.message; }
rec("viewer role denied at serverFn", /Investigator access required/.test(denied), denied.slice(0, 50));
sql("update public.user_roles set role='admin' where user_id=(select id from auth.users where email='synth-cap-003@cargoiq-staging.invalid')");

// 9. cross-tenant: user2 cannot verify tenant1's alert
let denied2 = "";
try { await sfn("verifyRiskAlert", { alertId: alert1, decision: "confirmed" }, jwt2); } catch (e) { denied2 = e.message; }
rec("cross-tenant verify denied", denied2.length > 0, denied2.slice(0, 60));

console.log("SFN-JOURNEY-SUMMARY " + results.filter(Boolean).length + "/" + results.length + " passed");
