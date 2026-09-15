import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, createSdkForServer } from "./server"
import { ClientError, OpenCode } from "@opencode-ai/client"
import { Accessor, createEffect, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

export type ServerHealth = { healthy: boolean; version?: string }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
  retryCount?: number
  retryDelayMs?: number
}

const defaultTimeoutMs = 30_000
const defaultRetryCount = 2
const defaultRetryDelayMs = 100
const cacheMs = 750
const healthCache = new Map<
  string,
  { at: number; done: boolean; fetch: typeof globalThis.fetch; promise: Promise<ServerHealth> }
>()

function cacheKey(server: ServerConnection.HttpBase) {
  return `${server.url}\n${server.username ?? ""}\n${server.password ?? ""}`
}

function timeoutSignal(timeoutMs: number) {
  const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (timeout) {
    try {
      return {
        signal: timeout.call(AbortSignal, timeoutMs),
        clear: undefined as (() => void) | undefined,
      }
    } catch {}
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function linkSignals(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const defined = signals.filter((s): s is AbortSignal => !!s)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  const any = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any
  if (any) return any.call(AbortSignal, defined)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  for (const signal of defined) {
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener("abort", onAbort, { once: true })
  }
  return controller.signal
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function retryable(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (error instanceof ClientError) return error.reason === "Transport"
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error instanceof TypeError) return true
  return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

export async function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  // Combine (not choose between) the caller's signal and the per-attempt
  // timeout so an aborted caller also cuts off an in-flight request, and a
  // hung request still respects `timeoutMs`.
  const timeout = timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = linkSignals([opts?.signal, timeout.signal])
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs
  const next = (count: number, error: unknown) => {
    if (count >= retryCount || !retryable(error, signal)) return Promise.resolve({ healthy: false } as const)
    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch(() => ({ healthy: false }))
  }
  const attempt = async (count: number): Promise<ServerHealth> => {
    const current = await OpenCode.make({
      baseUrl: server.url,
      fetch,
      headers: server.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
          }
        : undefined,
    })
      .health.get({ signal })
      .then((x) =>
        typeof x.healthy === "boolean"
          ? { data: { healthy: x.healthy, version: x.version } }
          : { error: new Error("Invalid health response") },
      )
      .catch((error) => ({ error }))
    if ("data" in current && current.data) return current.data
    if (signal?.aborted) return { healthy: false }

    return createSdkForServer({ server, fetch, signal })
      .global.health()
      .then((x) => (x.error ? next(count, x.error) : { healthy: x.data?.healthy === true, version: x.data?.version }))
      .catch((error) => next(count, error))
  }
  return attempt(0).finally(() => timeout?.clear?.())
}

const pollMs = 10_000

export function useCheckServerHealth() {
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  return (http: ServerConnection.HttpBase) => {
    const key = cacheKey(http)
    const hit = healthCache.get(key)
    const now = Date.now()
    if (hit && hit.fetch === fetcher && (!hit.done || now - hit.at < cacheMs)) return hit.promise
    const promise = checkServerHealth(http, fetcher).finally(() => {
      const next = healthCache.get(key)
      if (!next || next.promise !== promise) return
      next.done = true
      next.at = Date.now()
    })
    healthCache.set(key, { at: now, done: false, fetch: fetcher, promise })
    return promise
  }
}

export interface WaitForServerReadyOptions {
  timeoutMs?: number
  pollMs?: number
  signal?: AbortSignal
}

/**
 * Bounded startup precheck: poll the server health endpoint until it reports
 * healthy or the timeout elapses. This prevents the bootstrap fan-out of
 * `get`/`list` requests from racing a not-yet-listening local sidecar server,
 * which would otherwise throw an unhandled `TypeError: Failed to fetch` in the
 * render process. Resolves immediately when the server is already reachable.
 *
 * Each attempt is bounded by both the poll budget and the time left before the
 * overall deadline, so a hung request cannot push the total wall clock past
 * `timeoutMs`. When `opts.signal` fires, the in-flight request is aborted and
 * the poll loop returns promptly.
 */
export async function waitForServerReady(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: WaitForServerReadyOptions,
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 10_000
  const pollMs = opts?.pollMs ?? 250
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) return false
    const remaining = Math.max(deadline - Date.now(), 1)
    const healthy = await checkServerHealth(server, fetch, {
      timeoutMs: Math.min(pollMs * 4, 1_000, remaining),
      retryCount: 0,
      signal: opts?.signal,
    }).catch(() => ({ healthy: false }) as ServerHealth)
    if (healthy.healthy) return true
    await wait(pollMs, opts?.signal).catch(() => undefined)
  }
  return false
}

export const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          const key = ServerConnection.key(conn)
          const result = await checkServerHealth(conn.http)
          results[key] = result
          if (!dead) setStatus(key, result)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return status
}
