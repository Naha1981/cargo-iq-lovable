// Persist only opaque operation key and SHA-256 of the payload, never invoice
// data. A page reload after an uncertain response reuses the same operation key.
export interface RequestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export async function recoveryRequestKey(
  storage: RequestStorage,
  caseId: string,
  payload: unknown,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = "cargoiq:recovery-request:" + caseId + ":" + hash;
  let previous: { id?: string; hash?: string } | null = null;
  try {
    previous = JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    throw new Error("REQUEST_STORE_CORRUPT: do not retry until the previous comparison is checked");
  }
  if (previous?.hash === hash && previous.id) return previous.id;
  const id = crypto.randomUUID();
  storage.setItem(key, JSON.stringify({ id, hash }));
  return id;
}
export async function clearRecoveryRequest(
  storage: RequestStorage,
  caseId: string,
  payload: unknown,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  storage.removeItem("cargoiq:recovery-request:" + caseId + ":" + hash);
}
