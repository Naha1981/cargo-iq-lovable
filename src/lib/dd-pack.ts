// Readable evidence-pack text for managed D&D claims. Reads only the frozen
// recoveryFindings rows already in the pack payload (calculation.dd), so no new
// query or table is needed. Money is stated as claimed, and as recovered only when
// the claim has a confirmed outcome with a reference.
interface DdRow {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  currency?: unknown;
  calculation?: unknown;
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

export function isDdRow(row: DdRow): boolean {
  return Boolean(obj(obj(row.calculation).dd).party);
}

export function ddPackLines(row: DdRow): string[] {
  const dd = obj(obj(row.calculation).dd);
  const cur = String(row.currency ?? "");
  const claim = Number(dd.claimAmount ?? 0);
  const L: string[] = [];
  L.push(String(row.title ?? "D&D claim") + " [" + String(row.status ?? "") + "]");
  L.push(
    "Party: " +
      String(dd.party) +
      ". Amount claimed: " +
      cur +
      " " +
      claim.toFixed(2) +
      " (a claim, not a recovery).",
  );
  for (const t of arr(dd.totals))
    L.push(
      "Class " +
        String(t.classification) +
        ": " +
        String(t.days) +
        " day(s), " +
        cur +
        " " +
        Number(t.amount).toFixed(2),
    );
  for (const e of arr(dd.exceptions)) L.push("Flag " + String(e.code) + ": " + String(e.message));
  for (const t of arr(dd.timeline))
    L.push(
      "Timeline " +
        String(t.date) +
        ": " +
        String(t.event) +
        (t.source ? " (ref " + String(t.source) + ")" : ""),
    );
  const letter = obj(dd.letter);
  if (letter.body) {
    L.push(
      "Letter readiness: " +
        (letter.readyToSend ? "ready" : "not ready: " + arr(letter.blockers).join(" ")),
    );
    L.push("Letter subject: " + String(letter.subject));
  }
  const track = obj(dd.track);
  if (track.sentAt) {
    L.push(
      "Sent " +
        String(track.sentAt).slice(0, 10) +
        " by " +
        String(track.channel) +
        " to " +
        String(track.recipient) +
        (track.reference ? " (ref " + String(track.reference) + ")" : ""),
    );
    for (const e of arr(track.events)) {
      L.push(
        "Event " +
          String(e.at).slice(0, 10) +
          " " +
          String(e.kind) +
          (e.outcome ? " " + String(e.outcome) : "") +
          (e.amount != null ? " " + cur + " " + Number(e.amount).toFixed(2) : "") +
          (e.evidence ? " (evidence " + String(e.evidence) + ")" : ""),
      );
    }
    const out = arr(track.events).find((e) => e.kind === "outcome");
    L.push(
      out && out.outcome !== "rejected"
        ? "Confirmed recovered: " + cur + " " + Number(out.amount ?? 0).toFixed(2)
        : out
          ? "Claim rejected. Recovered: " + cur + " 0.00"
          : "Open claim. Recovered so far: " + cur + " 0.00",
    );
  } else L.push("Not yet recorded as sent. Recovered: " + cur + " 0.00");
  return L;
}
