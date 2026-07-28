// Shared helpers for walking a session's descendant tree from the SDK.
// The server only exposes a one-level `children` endpoint, so consumers
// that need the transitive set (run-mode permission routing, blocker
// bootstrap, etc.) walk the tree client-side. Centralising the BFS here
// keeps the depth invariant consistent across call sites — see
// `run.ts:loop` and `stream.transport.ts:bootstrap`.

import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionAncestry } from "@/session/ancestry"

export type DescendantInfo = { id: string; title?: string }

export type SessionTreeOwnership = SessionAncestry.Ownership<undefined>
export type SessionTreeResolution = SessionAncestry.Resolution<undefined>

export type DescendantFetchFailure = {
  sessionID: string
  error: unknown
}

export type DescendantFetchOptions = {
  signal?: AbortSignal
  concurrency?: number
  timeoutMs?: number
  totalTimeoutMs?: number
  limit?: number
}

export class DescendantFetchError extends Error {
  readonly partial: DescendantInfo[]
  readonly failures: DescendantFetchFailure[]

  constructor(partial: DescendantInfo[], failures: DescendantFetchFailure[]) {
    super(`failed to fetch children for ${failures.map((item) => item.sessionID).join(", ")}`)
    this.name = "DescendantFetchError"
    this.partial = partial
    this.failures = failures
  }
}

export async function fetchDescendants(
  sdk: OpencodeClient,
  sessionID: string,
  input: DescendantFetchOptions = {},
): Promise<DescendantInfo[]> {
  const out: DescendantInfo[] = []
  const failures: DescendantFetchFailure[] = []
  const seen = new Set<string>([sessionID])
  const concurrency = positiveInteger(input.concurrency, 4)
  const timeoutMs = positiveInteger(input.timeoutMs, 10_000)
  const totalTimeoutMs = positiveInteger(input.totalTimeoutMs, 30_000)
  const limit = positiveInteger(input.limit, 1_000)
  const deadline = Date.now() + totalTimeoutMs
  let limited = false
  let expired = false
  let frontier = [sessionID]
  while (frontier.length) {
    input.signal?.throwIfAborted()
    const current = frontier
    const next: string[] = []
    for (let offset = 0; offset < current.length; offset += concurrency) {
      input.signal?.throwIfAborted()
      const group = current.slice(offset, offset + concurrency)
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        failures.push({ sessionID: group[0]!, error: new Error(`session tree lookup exceeded ${totalTimeoutMs}ms`) })
        expired = true
        break
      }
      const batches = await Promise.allSettled(
        group.map(async (id) => {
          const timeout = new AbortController()
          const timer = setTimeout(
            () => timeout.abort(new Error(`children lookup timed out for ${id}`)),
            Math.min(timeoutMs, remaining),
          )
          const signal = input.signal ? AbortSignal.any([input.signal, timeout.signal]) : timeout.signal
          try {
            const result = await sdk.session.children({ sessionID: id }, { throwOnError: true, signal })
            if (!result.data) throw new Error(`children lookup returned no data for ${id}`)
            return result.data
          } finally {
            clearTimeout(timer)
          }
        }),
      )
      input.signal?.throwIfAborted()
      for (const [index, batch] of batches.entries()) {
        if (batch.status === "rejected") {
          failures.push({ sessionID: group[index]!, error: batch.reason })
          continue
        }
        for (const child of batch.value) {
          if (seen.has(child.id)) continue
          if (seen.size >= limit) {
            if (!limited) {
              failures.push({ sessionID: child.id, error: new Error(`session tree exceeds ${limit} entries`) })
              limited = true
            }
            continue
          }
          seen.add(child.id)
          out.push(child)
          next.push(child.id)
        }
      }
    }
    if (expired) break
    frontier = next
  }
  if (failures.length) throw new DescendantFetchError(out, failures)
  return out
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

// Like `fetchDescendants` but returns just the id set including the root.
// Useful when the caller wants membership tests rather than the full info.
export async function fetchDescendantIDs(
  sdk: OpencodeClient,
  sessionID: string,
  input: DescendantFetchOptions = {},
): Promise<Set<string>> {
  const ids = new Set<string>([sessionID])
  for (const child of await fetchDescendants(sdk, sessionID, input)) {
    ids.add(child.id)
  }
  return ids
}

export function resolveSessionTreeOwnership(
  sdk: OpencodeClient,
  tree: Set<string>,
  sessionID: string,
  input: {
    signal: AbortSignal
    onUnknown?: (input: { error: unknown; attempt: number; retryIn: number }) => void
    attempts?: number
  },
): Promise<SessionTreeResolution> {
  return SessionAncestry.resolve({
    signal: input.signal,
    onRetry: input.onUnknown,
    attempts: input.attempts,
    lookup: (signal) => lookupSessionTreeOwnership(sdk, tree, sessionID, signal),
  })
}

export async function lookupSessionTreeOwnership(
  sdk: OpencodeClient,
  tree: Set<string>,
  sessionID: string,
  signal?: AbortSignal,
): Promise<SessionTreeOwnership> {
  try {
    const owned = await addAncestryToTree(sdk, tree, sessionID, signal)
    return owned ? { type: "owned", value: undefined } : { type: "foreign" }
  } catch (error) {
    return { type: "unknown", error }
  }
}

async function addAncestryToTree(sdk: OpencodeClient, tree: Set<string>, sessionID: string, signal?: AbortSignal) {
  if (tree.has(sessionID)) return true

  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | undefined = sessionID
  while (current) {
    if (seen.has(current)) {
      throw new Error(`parent chain cycle detected for ${sessionID}: ${[...chain, current].join(" -> ")}`)
    }
    seen.add(current)
    chain.push(current)
    if (tree.has(current)) {
      for (const id of chain) tree.add(id)
      return true
    }

    const result: { data?: { parentID?: string }; error?: unknown } = await sdk.session.get(
      { sessionID: current },
      { throwOnError: true, ...(signal ? { signal } : {}) },
    )
    if (result.error !== undefined) throw result.error
    if (!result.data) throw new Error(`session lookup returned no data for ${current}`)
    current = result.data.parentID
  }
  return false
}

export async function replyPermission(
  sdk: OpencodeClient,
  input: { requestID: string; reply: "once" | "always" | "reject"; directory?: string },
) {
  try {
    const result: unknown = await sdk.permission.reply(input, { throwOnError: true })
    if (typeof result === "object" && result !== null && "error" in result && result.error !== undefined) {
      throw result.error
    }
  } catch (error) {
    // The server drops a pending request when its session is aborted or the
    // turn tears down, and it also rejects the whole cascade itself. A reply
    // that lost that race is already answered, so treat it as done rather than
    // failing the run.
    if (isPermissionNotFound(error)) return
    throw error
  }
}

function isPermissionNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === "PermissionNotFoundError"
}
