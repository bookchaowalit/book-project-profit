/**
 * One key per distinct submission. The same key is reused only when the user
 * explicitly retries the same (failed) payload; a changed payload or a
 * success starts a new submission. Nothing here retries automatically.
 */
export function createIdempotencyTracker(generate: () => string = () => crypto.randomUUID()) {
  let pending: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(fingerprint: string): string {
      if (pending && pending.fingerprint === fingerprint) return pending.key;
      pending = { fingerprint, key: generate() };
      return pending.key;
    },
    succeeded() {
      pending = null;
    },
    reset() {
      pending = null;
    },
  };
}
export type IdempotencyTracker = ReturnType<typeof createIdempotencyTracker>;
