// Insert a claim with its reading-order number. Retries WITHOUT source_seq only when the
// database says that exact column does not exist (the insert was rejected, so nothing was stored).
// Any other error (RLS, constraint, network, provider) is returned untouched and never retried.
export function isMissingSourceSeqColumn(error: any): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "");
  return (code === "42703" || code === "PGRST204") && /source_seq/.test(msg);
}

export async function insertClaimRow(supabase: any, base: Record<string, unknown>, seq: number) {
  const first = await supabase.from("extracted_claims").insert({ ...base, source_seq: seq }).select("*").single();
  if (!isMissingSourceSeqColumn(first.error)) return first;
  return supabase.from("extracted_claims").insert(base).select("*").single();
}
