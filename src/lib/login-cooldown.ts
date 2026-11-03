/** One bounded retry for a rate-limited password sign-in. No signup/reset retries. */
export type LoginResult = {
  error: { status?: number | undefined; code?: string | undefined } | null;
};
export async function signInWithCooldown<T extends LoginResult>(
  attempt: () => Promise<T>,
  options: {
    signal: AbortSignal;
    onWait: (seconds: number) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    random?: () => number;
  },
): Promise<T> {
  const sleep =
    options.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Cancelled", "AbortError"));
          return;
        }
        const cancel = () => {
          clearTimeout(timer);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", cancel);
          resolve();
        }, ms);
        signal.addEventListener("abort", cancel, { once: true });
      }));
  options.signal.throwIfAborted();
  const first = await attempt();
  if (first.error?.status !== 429 && first.error?.code !== "over_request_rate_limit") return first;
  // Wait a full minute plus jitter. Never rotate sources, weaken limits or retry indefinitely.
  const seconds = 65 + Math.floor((options.random ?? Math.random)() * 15);
  options.onWait(seconds);
  await sleep(seconds * 1000, options.signal);
  options.signal.throwIfAborted();
  return attempt();
}
