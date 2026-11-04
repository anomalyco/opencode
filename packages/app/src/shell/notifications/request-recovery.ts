import { createEffect, onCleanup } from "solid-js"
import type { ServerSDK } from "@/runtime/server/client"
import type { Data } from "@opencode/client/solid"

/**
 * Pending questions and permission requests normally reach the app only as live events. A tab that slept,
 * or an event stream that stalled without disconnecting, misses them: the session then waits for an answer while the
 * app shows no dock, inbox entry or notification until a reload. This re-loads the pending requests of every session
 * the server reports as running, on a timer, on reconnect and when the window regains focus, and passes each one to
 * the normal notification path, which alerts once per request.
 */

export const REQUEST_RECOVERY_INTERVAL_MS = 30_000

/** Bounds one check if many sessions run at once; the rest are picked up by later checks. */
export const REQUEST_RECOVERY_MAX_SESSIONS = 50

export type RecoveredRequestKind = "permission" | "question" | "mcp-elicitation" | "websearch.provider"

const formKinds: readonly RecoveredRequestKind[] = ["question", "mcp-elicitation", "websearch.provider"]

/** The slice of the session store recovery reads; `Data["session"]` satisfies it. */
type PendingStore<T> = {
  invalidate: (sessionID: string) => void
  sync: (sessionID: string) => Promise<void>
  list: (sessionID: string) => readonly T[] | undefined
}

export type RequestRecoverySource = {
  /** Session IDs the server reports as running. */
  active: () => Promise<readonly string[]>
  form: PendingStore<{ id: string; metadata?: { kind?: unknown } }>
  permission: PendingStore<{ id: string }>
}

/** Re-load pending requests of running sessions and report each one still pending. */
export async function recoverPendingRequests(
  source: RequestRecoverySource,
  onRequest: (kind: RecoveredRequestKind, sessionID: string, requestID: string) => void,
) {
  const sessions = (await source.active()).slice(0, REQUEST_RECOVERY_MAX_SESSIONS)
  await Promise.allSettled(
    sessions.map((sessionID) => {
      source.form.invalidate(sessionID)
      source.permission.invalidate(sessionID)

      return Promise.allSettled([source.form.sync(sessionID), source.permission.sync(sessionID)])
    }),
  )

  for (const sessionID of sessions) {
    for (const form of source.form.list(sessionID) ?? []) {
      const kind = formKinds.find((item) => item === form.metadata?.kind)

      if (kind) onRequest(kind, sessionID, form.id)
    }

    for (const request of source.permission.list(sessionID) ?? []) onRequest("permission", sessionID, request.id)
  }

  return sessions.length
}

export function createRequestRecovery(input: {
  sdk: ServerSDK
  data: Data
  onRequest: (kind: RecoveredRequestKind, sessionID: string, requestID: string) => void
  interval?: number
}) {
  const source: RequestRecoverySource = {
    active: () => input.sdk.api.session.active().then((active) => Object.keys(active)),
    form: input.data.session.form,
    permission: input.data.session.permission,
  }

  let checking = false
  let disposed = false

  const check = () => {
    if (disposed || checking || input.sdk.connection.status() !== "connected") return

    checking = true
    void recoverPendingRequests(source, (kind, sessionID, requestID) => {
      if (!disposed) input.onRequest(kind, sessionID, requestID)
    })
      .catch(() => undefined)
      .finally(() => {
        checking = false
      })
  }

  createEffect(() => {
    if (input.sdk.connection.status() === "connected") check()
  })

  const timer = setInterval(check, input.interval ?? REQUEST_RECOVERY_INTERVAL_MS)

  const onVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") check()
  }

  if (typeof window !== "undefined") {
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", onVisible)
  }

  onCleanup(() => {
    disposed = true
    clearInterval(timer)

    if (typeof window !== "undefined") {
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", onVisible)
    }
  })

  return { check }
}
