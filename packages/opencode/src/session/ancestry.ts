// Shared bounded retry for "which session that I own does this descendant
// belong to" lookups. Both the ACP permission handler and run mode need it, and
// keeping one implementation stops the two from drifting apart.
//
// The lookup fails transiently for a server restart mid-flight, a 5xx, or a
// grandchild whose `session.created` has not been projected yet — all worth
// retrying. It also fails permanently for a parent chain cycle or a `parentID`
// pointing at a deleted session. Retrying forever turns those into a permanent
// hang, which is the exact symptom this routing exists to remove, so the retry
// is bounded and exhaustion is reported so callers can reject the request
// instead of leaving the nested tool call waiting.

export type Ownership<T> = { type: "owned"; value: T } | { type: "foreign" } | { type: "unknown"; error: unknown }

export type Resolution<T> =
  | { type: "owned"; value: T }
  | { type: "foreign" }
  | { type: "cancelled" }
  | { type: "exhausted"; error: unknown }

// 100, 200, 400, 800, 1600, 2000, 2000 -> about 7s before giving up. Long enough
// to ride out a server restart, short enough that a cycle surfaces promptly.
export const MAX_ATTEMPTS = 8

export function retryDelay(attempt: number) {
  return Math.min(100 * 2 ** Math.min(attempt - 1, 4), 2_000)
}

export async function resolve<T>(input: {
  signal: AbortSignal
  lookup: (signal: AbortSignal) => Promise<Ownership<T>>
  onRetry?: (input: { error: unknown; attempt: number; retryIn: number }) => void
  attempts?: number
}): Promise<Resolution<T>> {
  const attempts = input.attempts ?? MAX_ATTEMPTS
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (input.signal.aborted) return { type: "cancelled" }
    const ownership = await input.lookup(input.signal)
    if (input.signal.aborted) return { type: "cancelled" }
    if (ownership.type !== "unknown") return ownership
    last = ownership.error
    if (attempt === attempts) break
    const retryIn = retryDelay(attempt)
    input.onRetry?.({ error: ownership.error, attempt, retryIn })
    if (!(await wait(retryIn, input.signal))) return { type: "cancelled" }
  }
  return { type: "exhausted", error: last }
}

function wait(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      resolve(ready)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), delay)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

export * as SessionAncestry from "./ancestry"
