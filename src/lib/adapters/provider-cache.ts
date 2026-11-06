// Per-isolate request coalescing and cooldown. It never retries a throttled request.
const entries = new Map<
  string,
  { value?: unknown; expires: number; blockedUntil: number; pending?: Promise<unknown> }
>();
export async function cachedProvider<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = 300_000,
): Promise<T> {
  const now = Date.now();
  let e = entries.get(key);
  if (e && e.blockedUntil > now)
    throw new Error(
      "PROVIDER_COOLDOWN: " + key + " until " + new Date(e.blockedUntil).toISOString(),
    );
  if (e && e.value !== undefined && e.expires > now) return e.value as T;
  if (e?.pending) return e.pending as Promise<T>;
  if (!e) {
    e = { expires: 0, blockedUntil: 0 };
    entries.set(key, e);
  }
  const state = e;
  const pending = load()
    .then((value) => {
      state.value = value;
      state.expires = Date.now() + ttlMs;
      return value;
    })
    .catch((error) => {
      if (/429/.test(String(error))) state.blockedUntil = Date.now() + 3_600_000;
      throw error;
    })
    .finally(() => {
      state.pending = undefined;
    });
  state.pending = pending;
  return pending;
}
