import {frozenOperationalResults} from "./count-pack";
// Dependency-free, deterministic PDF writer for the Evidence Pack.
// Runs entirely in the browser: no network, no external service. Same pack in = same bytes out.

const W: Record<string, number> = {};
(() => {
  const raw =
    "32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,58:278,59:278,60:584,61:584,62:584,63:556,64:1015," +
    "65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,75:667,76:556,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611," +
    "91:278,92:278,93:278,94:469,95:556,96:333," +
    "97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,106:222,107:500,108:222,109:833,110:556,111:556,112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500," +
    "123:334,124:260,125:334,126:584";
  for (const p of raw.split(",")) { const [c, w] = p.split(":"); W[String.fromCharCode(Number(c))] = Number(w); }
  for (let c = 48; c <= 57; c++) W[String.fromCharCode(c)] = 556;
})();

function clean(input: unknown): string {
  const s = String(input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2014\u2013\u2212]/g, "-")
    .replace(/[\u00b7\u2022]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\t]/g, " ");
  return s.replace(/[^\x20-\x7e\n]/g, "?");
}

function width(text: string, size: number, bold: boolean) {
  let w = 0;
  for (const ch of text) w += W[ch] ?? 556;
  return (w / 1000) * size * (bold ? 1.07 : 1);
}

function esc(s: string) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }

function wrap(text: string, size: number, bold: boolean, maxW: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      // Break very long tokens (hashes, ids) so nothing overflows the page.
      while (width(word, size, bold) > maxW) {
        let cut = word.length;
        while (cut > 1 && width(word.slice(0, cut), size, bold) > maxW) cut--;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? line + " " + word : word;
      if (line && width(next, size, bold) > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

type Op = { x: number; y: number; text: string; size: number; bold: boolean; gray?: number };
type Rule = { y: number };

const PAGE_W = 595, PAGE_H = 842, MX = 50, TOP = 60, BOTTOM = 62;

class Doc {
  pages: { ops: Op[]; rules: Rule[] }[] = [{ ops: [], rules: [] }];
  y = PAGE_H - TOP;
  private page() { return this.pages[this.pages.length - 1]!; }
  private ensure(h: number) {
    if (this.y - h < BOTTOM) { this.pages.push({ ops: [], rules: [] }); this.y = PAGE_H - TOP; }
  }
  reserve(h: number) { this.ensure(h); }
  gap(h: number) { this.y -= h; }
  rule() { this.ensure(8); this.page().rules.push({ y: this.y }); this.y -= 8; }
  text(t: string, o: { size?: number; bold?: boolean; indent?: number; gray?: number; keep?: boolean } = {}) {
    const size = o.size ?? 9.5, bold = o.bold ?? false, indent = o.indent ?? 0;
    const lines = wrap(t, size, bold, PAGE_W - 2 * MX - indent);
    const lh = size * 1.32;
    for (const line of lines) {
      this.ensure(lh);
      this.y -= lh;
      this.page().ops.push({ x: MX + indent, y: this.y, text: line, size, bold, gray: o.gray });
    }
  }
  height(t: string, o: { size?: number; bold?: boolean; indent?: number } = {}) {
    const size = o.size ?? 9.5;
    return wrap(t, size, o.bold ?? false, PAGE_W - 2 * MX - (o.indent ?? 0)).length * size * 1.32;
  }
  heading(t: string) {
    this.gap(10); this.ensure(40);
    this.text(t.toUpperCase(), { size: 11, bold: true });
    this.rule();
  }
}

function money(minor: unknown, currency: unknown) {
  if (minor == null || minor === "") return "n/a";
  const n = Number(minor) / 100;
  if (!Number.isFinite(n)) return "n/a";
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "") + String(currency ?? "ZAR") + " " + i!.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + d;
}

function stamp(s: unknown) {
  const t = Date.parse(String(s ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z" : String(s ?? "n/a");
}

export function buildEvidencePackPdf(pack: any): Uint8Array {
  const p = pack.pack_payload ?? {};
  const c = p.case ?? {};
  const docs: any[] = p.documents ?? [];
  const docName = new Map<string, string>(docs.map((d: any) => [d.id, d.name]));
  const claims: any[] = p.claims ?? [];
  const d = new Doc();

  d.text("CargoIQ", { size: 10, bold: true, gray: 0.4 });
  d.text("Evidence Pack - Dispute Submission", { size: 20, bold: true });
  d.text("Case " + (c.reference_no ?? "n/a") + "  |  Pack v" + pack.version + "  |  Status: " + pack.status, { size: 10, gray: 0.3 });
  d.gap(6);

  d.heading("1. Case details");
  const rows: [string, unknown][] = [
    ["Reference", c.reference_no], ["Title", c.title], ["Vessel", c.vessel_name], ["Voyage", c.voyage_no],
    ["Container", c.container_no], ["Port", c.port_code], ["Counterparty", c.counterparty], ["Dispute type", c.dispute_type],
    ["Pack generated", stamp(p.generatedAt ?? pack.generated_at)],
  ];
  for (const [k, v] of rows) if (v != null && v !== "") d.text(k + ": " + v, { indent: 4 });

  d.heading("2. Source documents (" + docs.length + ")");
  if (!docs.length) d.text("No documents recorded.", { indent: 4 });
  docs.forEach((x, i) => {
    d.reserve(32);
    d.text((i + 1) + ". " + x.name + (x.source_party ? " (" + x.source_party + ")" : ""), { indent: 4, bold: true });
    d.text("Uploaded " + stamp(x.uploaded_at) + "  |  SHA-256 " + (x.sha256_hash ?? "n/a"), { indent: 14, size: 8, gray: 0.35 });
  });

  const nEv = (p.timeline ?? []).length;
  d.heading("3. Timeline (" + nEv + (nEv === 1 ? " event)" : " events)"));
  if (!(p.timeline ?? []).length) d.text("No timeline events recorded.", { indent: 4 });
  for (const e of p.timeline ?? []) {
    const evHead = stamp(e.timestamp) + "  [" + String(e.nature ?? "").toUpperCase() + "]";
    const evBody = String(e.title ?? "") + "  - Source: " + String(e.source ?? "n/a");
    d.reserve(d.height(evHead, { indent: 4, size: 8.5, bold: true }) + d.height(evBody, { indent: 14 }));
    d.text(evHead, { indent: 4, size: 8.5, bold: true });
    d.text(evBody, { indent: 14 });
  }

  const verified = claims.filter((x) => x.status === "VERIFIED");
  d.heading("4. Claims with sources (" + verified.length + " verified of " + claims.length + ")");
  if (!claims.length) d.text("No claims recorded.", { indent: 4 });
  const order = (s: string) => (s === "VERIFIED" ? 0 : s === "PENDING" ? 1 : 2);
  [...claims].sort((a, b) => order(a.status) - order(b.status)).forEach((x, i) => {
    const claimLine = (i + 1) + ". [" + String(x.status ?? "").toUpperCase() + " / " + String(x.nature ?? "").toUpperCase() + "] " + x.claim_text;
    const src = (docName.get(x.document_id) ?? "unknown document") + (x.page_number ? ", page " + x.page_number : "");
    const srcLine = "Source: " + src + (x.timestamp_claimed ? "  |  Claimed time: " + stamp(x.timestamp_claimed) : "") +
      (x.confidence != null ? "  |  Confidence: " + Math.round(Number(x.confidence) * 100) + "%" : "");
    // A claim and its source line stay on the same page.
    d.reserve(d.height(claimLine, { indent: 4 }) + d.height(srcLine, { indent: 14, size: 8 }));
    d.text(claimLine, { indent: 4 });
    d.text(srcLine, { indent: 14, size: 8, gray: 0.35 });
  });

  const contr: any[] = p.contradictions ?? [];
  d.heading("5. Contradictions and resolutions (" + contr.length + ")");
  if (!contr.length) d.text("No contradictions were detected.", { indent: 4 });
  contr.forEach((x, i) => {
    d.text((i + 1) + ". " + x.title + "  [" + x.status + "]", { indent: 4, bold: true });
    if (x.description) d.text(x.description, { indent: 14 });
    d.text("Resolution: " + (x.resolution_note ? x.resolution_note : x.status === "RESOLVED" ? "Resolved (no note recorded)" : "UNRESOLVED") +
      (x.resolved_at ? "  |  Resolved " + stamp(x.resolved_at) : ""), { indent: 14, size: 8.5 });
    if (x.resolution_document_id || x.resolution_evidence_reference) d.text("Resolution evidence: " + (docName.get(x.resolution_document_id) ?? x.resolution_document_id ?? "n/a") + ", " + (x.resolution_evidence_reference ?? "n/a"), {indent:14,size:8});
  });

  const calcs: any[] = p.financialCalculations ?? [];
  d.heading("6. Financial summary");
  if (!calcs.length) d.text("No financial calculation recorded. No amount is stated or implied.", { indent: 4 });
  calcs.forEach((x, i) => {
    d.text((i + 1) + ". " + String(x.calculation_type ?? "Calculation") + "  (rule " + String(x.rule_version ?? "n/a") + ")", { indent: 4, bold: true });
    d.text("Calculated: " + money(x.calculated_amount_minor, x.currency) + "   Charged: " + money(x.charged_amount_minor, x.currency) +
      "   Variance: " + money(x.variance_minor, x.currency), { indent: 14 });
    const inp = x.input_payload ?? {};
    const parts = [inp.start && "start " + String(inp.start).slice(0, 10), inp.release && "release " + String(inp.release).slice(0, 10),
      inp.freeDays != null && "free days " + inp.freeDays, inp.units != null && "units " + inp.units].filter(Boolean);
    if (parts.length) d.text("Inputs: " + parts.join(", ") + "  |  Calculated " + stamp(x.created_at), { indent: 14, size: 8, gray: 0.35 });
  });

  const allObs: any[] = p.externalObservations ?? [];
  const snapshots = allObs.filter((o) => o.observation_type === "MAP_SNAPSHOT");
  const obs = allObs.filter((o) => o.observation_type !== "MAP_SNAPSHOT");
  if (obs.length) {
    d.heading("7. Independent observations (" + obs.length + ")");
    d.text("These are corroboration only. " + String(p.truthRule ?? ""), { indent: 4, size: 8.5 });
    obs.slice(0, 40).forEach((o) => d.text(stamp(o.observed_at) + "  " + String(o.observation_type ?? "") + "  - " + String(o.source ?? ""), { indent: 14, size: 8 }));
    if (obs.length > 40) d.text("... and " + (obs.length - 40) + " more in the JSON export.", { indent: 14, size: 8, gray: 0.35 });
  }

  if (snapshots.length) {
    d.heading("7b. Harbour map snapshots (" + snapshots.length + ")");
    d.text("Sealed map views added by the investigator from the harbour evidence map. The image file is retained in the case documents; its SHA-256 below proves the image has not changed. " +
      "A snapshot renders recorded AIS, satellite and case data at the chosen time - it corroborates recorded positions and coverage; it is not independent sensor data and does not by itself prove contractual liability.", { indent: 4, size: 8.5 });
    snapshots.forEach((o, i) => {
      const pl = o.payload ?? {};
      d.text((i + 1) + ". Map view at " + stamp(o.observed_at) + (pl.inDisputedWindow ? "  [INSIDE THE DISPUTED WINDOW" + (pl.windowStart && pl.windowEnd ? " " + stamp(pl.windowStart) + " to " + stamp(pl.windowEnd) : "") + "]" : ""), { indent: 4, bold: true, size: 9 });
      const parts = [
        pl.vesselName && "Vessel: " + String(pl.vesselName) + (pl.mmsi ? " (MMSI " + String(pl.mmsi) + ")" : ""),
        o.latitude != null && o.longitude != null && "Position: " + Number(o.latitude).toFixed(5) + " / " + Number(o.longitude).toFixed(5),
        pl.sog != null && "Speed: " + String(pl.sog) + " kn",
        pl.cog != null && "Course: " + String(pl.cog) + " deg",
      ].filter(Boolean);
      if (parts.length) d.text(parts.join("  |  "), { indent: 14, size: 8.5 });
      if (pl.note) d.text("Note: " + String(pl.note), { indent: 14, size: 8.5 });
      d.text("Image: " + (docName.get(pl.document_id) ?? "case document") + "  |  SHA-256 " + String(pl.sha256 ?? "n/a"), { indent: 14, size: 8, gray: 0.35 });
    });
  }

  const operationalSections: [string, string, (x: any) => string][] = [
    ["countSourceRecords", "Raw count source ledger (all versions)", (x) => x.party+" / "+x.physical_reference+" v"+x.version+"\nReported: "+x.quantity+" "+x.basis+"; metric "+x.metric+"; gate "+x.gate_kind+"\n20ft: "+(x.containers20??"unknown")+"; 40ft: "+(x.containers40??"unknown")+"; occurred "+x.occurred_at+"\nLimitations: "+x.limitations],
    ["countRuleVersions", "Executable local count rules (all versions)", (x) => x.name+" v"+x.version+" ["+x.acceptance+"]\n"+x.input_basis+" to "+x.output_unit+": "+x.calculation+" x "+x.numerator+"/"+x.denominator+"\nEffective: "+x.effective_from+" to "+(x.effective_to??"open")+"; gates "+x.gate_kinds.join(", ")+"\nRationale: "+x.rationale],
    ["countComparisons", "Explicit common-unit scopes and productivity definitions", (x) => x.name+" v"+x.version+" ["+x.acceptance+"]\nPhysical scope: "+x.physical_references.join(", ")+"\nMappings: "+x.rule_ids.join(", ")+"; duration definition "+(x.kpi_definition_id??"none")+"\nAgreement / limitations: "+x.rationale],
    ["appointmentLifecycle", "Appointment revisions, attendance and human causal review", (x) => x.appointment_reference+" / "+x.physical_reference+" / "+x.record_type+" v"+x.version+"\nIssuer: "+x.issuer+"; source party "+x.party+"\nEvent: "+x.occurred_at+"; window "+(x.start_at??"n/a")+" to "+(x.end_at??"n/a")+"\nClaim target: "+(x.claim_target||"not assessed")+" ["+x.outcome+"]\n"+x.explanation+"\nTerms / causal basis: "+x.terms_reference],
    ["authorisedImports", "Authorised export provenance (operator assertion, not access proof)", (x) => x.dataset+" / "+x.row_count+" rows; source party "+x.source_party+"\nExported: "+x.exported_at+"; imported: "+x.created_at+"; actor "+x.created_by+"\nRaw CSV SHA256: "+x.raw_sha256+"\nAuthority basis: "+x.authorization_basis+"\nOriginal CSV and typed mapping retained in frozen JSON. Hash proves integrity, not truth."],
    ["operationalDefinitions", "Operational counting definitions (all versions)", (x) => x.party + " / " + x.metric + " v" + x.version + " [" + x.acceptance + "]\nUnit: " + x.unit + "\nRule: " + x.rule + "\nOriginal: " + x.original_source_text + "\nEffective: " + x.effective_from + " to " + (x.effective_to ?? "open-ended") + "\nAcceptance basis: " + x.acceptance_basis],
    ["operationalClocks", "Separate source clocks", (x) => x.physical_reference + " / " + x.kind + "\nOriginal time: " + x.timestamp_original + " (" + x.time_zone + ")\nSource organization: " + x.source_party + "\nLocation/event basis: " + x.location_basis + (x.appointment_issuer ? "\nAppointment issuer: " + x.appointment_issuer + "; ref " + x.appointment_reference + "\nParties: " + x.appointment_parties + "\nTerms: " + x.appointment_terms : "")],
    ["appointmentAttributions", "Appointment-to-claim attribution (not liability)", (x) => "Appointment clock " + x.appointment_clock_id + "\nClaimant: " + x.claimant + "; target: " + x.claim_target + "\nAssertion: " + x.assertion + "\nTerms reference: " + x.terms_reference],
    ["kpiDefinitions", "Per-party KPI definitions (no universal benchmark)", (x) => x.party + " / " + x.name + " v" + x.version + " [" + x.acceptance + "]\nScope: " + x.physical_reference + "\nClock: " + x.start_kind + " to " + x.end_kind + "\nDefinition: " + x.definition + "\nBenchmark hours: " + (x.benchmark_hours ?? "not supplied") + "\nBenchmark basis: " + x.benchmark_basis],
    ["crossPartyMatches", "Human-confirmed physical-event matches", (x) => x.event_reference + " [" + x.result + "]\nSource claims: " + x.claim_a_id + " / " + x.claim_b_id + "\nIdentity rationale: " + x.rationale],
    ["eventIdentityReviews", "Event-identity corrections (history retained)", (x) => "Match " + x.match_id + " v" + x.version + " [" + x.status + "]\nEvidence explanation: " + x.explanation],
    ["clockReconciliations", "Evidenced clock reconciliation decisions", (x) => x.physical_reference + " / " + x.kind + " v" + x.version + "\nSelected clock: " + x.selected_clock_id + "\nConsidered source IDs: " + (x.considered_clock_ids ?? []).join(", ") + "\nEvidence explanation: " + x.explanation],
    ["evidenceGapHistory", "Required evidence and gaps (not proof of non-occurrence)", (x) => x.physical_reference + " / " + x.required_event + " v" + x.version + " [" + x.status + "]\nRequirement basis: " + x.requirement_basis + "\nExplanation: " + x.explanation + "\nSource documents: " + (x.document_ids ?? []).map((id: string) => docName.get(id) ?? id).join(", ") + "\nEvidence reference: " + x.evidence_reference],
  ];
  for (const [key, title, describe] of operationalSections) {
    const records: any[] = p[key] ?? [];
    if (!records.length) continue;
    d.heading(title + " (" + records.length + ")");
    for (const x of records) {
      d.text(describe(x), {indent:4});
      if (x.source_document_id) d.text("Source: " + (docName.get(x.source_document_id) ?? x.source_document_id) + ", " + (x.source_reference ?? "n/a"), {indent:14,size:8,gray:0.35});
      d.gap(6);
    }
  }
  // Keep approval lines and limitations together instead of orphaning the caveat.
  d.reserve(245);
  const frozen=frozenOperationalResults(p);
  if(frozen.counts.length||frozen.appointments.length){
    d.heading("Frozen operational calculations (engine v1)");
    d.text("Derived only from this frozen payload. Different count bases and lateness are not factual contradictions or proof of liability.",{indent:4,size:8});
    for(const {definition,result} of frozen.counts){
      d.text(definition.name+": "+(result.comparable?"COMPARABLE DERIVED VALUES":"COMPARISON WITHHELD"),{indent:4,bold:true});
      for(const issue of result.issues)d.text(issue,{indent:14});
      for(const r of result.results){d.text(r.party+": "+(r.total===null?"WITHHELD":r.total+" "+definition.outputUnit)+(definition.kpiDefinitionId?"; productivity "+(r.perHour===null?"WITHHELD":r.perHour.toFixed(3)+" "+definition.outputUnit+"/hour")+"; evidenced hours "+(r.hours??"unknown"):""),{indent:14});for(const reason of [...r.reasons,...r.productivityReasons])d.text(reason,{indent:24,size:8});}
    }
    for(const a of frozen.appointments){d.text(a.reference+": "+a.timing+"; minutes after slot end "+(a.minutesLate??"withheld"),{indent:4});for(const reason of a.reasons)d.text(reason,{indent:14,size:8});d.text(a.disclaimer,{indent:14,size:8});}
  }

  d.heading("Integrity and approval");
  d.text(pack.status === "APPROVED" ? "SHA-256 of the canonical pack payload:" : "SHA-256 of this draft pack payload (final hash is set when the pack is approved):", { indent: 4 });
  d.text(String(pack.sha256_hash ?? "n/a"), { indent: 4, bold: true, size: 9 });
  d.text("The JSON export of this same pack version carries the full payload this hash was calculated over.", { indent: 4, size: 8.5, gray: 0.35 });
  d.gap(6);
  d.text("Status: " + pack.status + (pack.status === "APPROVED" && pack.approved_by ? "  |  Approved by user ID " + pack.approved_by : "  |  Not yet approved"), { indent: 4 });
  d.gap(18);
  for (const label of ["Name", "Signature", "Date"]) {
    d.text(label + ": ______________________________________________", { indent: 4 });
    d.gap(10);
  }
  d.gap(4);
  const hasMapData = allObs.length > 0;
  d.text((hasMapData ? "Limitations: AIS can contain gaps, spoofing or stale identity data. Satellite scene availability is not cargo-level proof. Weather provides context only. " : "Limitations: this pack contains document claims only. ") +
    "Claims marked PENDING have not been verified. Human review is required for disputed claims.", { size: 8, gray: 0.35 });

  return serialize(d.pages, pack);
}

function serialize(pages: { ops: Op[]; rules: Rule[] }[], pack: any): Uint8Array {
  const total = pages.length;
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add("");
  const pagesRoot = add("");
  const fReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  pages.forEach((pg, i) => {
    let s = "";
    for (const r of pg.rules) s += "0.75 G 0.5 w " + MX + " " + f(r.y) + " m " + (PAGE_W - MX) + " " + f(r.y) + " l S\n";
    for (const o of pg.ops) {
      const g = o.gray ?? 0;
      s += "BT " + g + " g /" + (o.bold ? "F2" : "F1") + " " + f(o.size) + " Tf " + f(o.x) + " " + f(o.y) + " Td (" + esc(o.text) + ") Tj ET\n";
    }
    const foot = "CargoIQ Evidence Pack v" + pack.version + "  |  SHA-256 " + String(pack.sha256_hash ?? "").slice(0, 16) + "...  |  Page " + (i + 1) + " of " + total;
    s += "0.75 G 0.5 w " + MX + " 44 m " + (PAGE_W - MX) + " 44 l S\nBT 0.35 g /F1 7.5 Tf " + MX + " 32 Td (" + esc(clean(foot)) + ") Tj ET\n";
    const content = add("<< /Length " + s.length + " >>\nstream\n" + s + "endstream");
    kids.push(add("<< /Type /Page /Parent " + pagesRoot + " 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] /Resources << /Font << /F1 " + fReg + " 0 R /F2 " + fBold + " 0 R >> >> /Contents " + content + " 0 R >>"));
  });
  const created = new Date(Date.parse(pack.pack_payload?.generatedAt ?? pack.generated_at ?? "") || 0).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const info = add("<< /Title (" + esc(clean("CargoIQ Evidence Pack " + (pack.pack_payload?.case?.reference_no ?? "") + " v" + pack.version)) + ") /Producer (CargoIQ) /CreationDate (D:" + created + "Z) >>");
  objs[catalog - 1] = "<< /Type /Catalog /Pages " + pagesRoot + " 0 R >>";
  objs[pagesRoot - 1] = "<< /Type /Pages /Kids [" + kids.map((k) => k + " 0 R").join(" ") + "] /Count " + kids.length + " >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = out.length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root " + catalog + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
