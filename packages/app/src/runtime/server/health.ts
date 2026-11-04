import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { authTokenFromCredentials } from "./api"
import {
  createServerHealthState,
  selectServerHealthRecord,
  transitionServerHealth,
  type ServerHealth,
  type ServerHealthEvent,
  type ServerHealthInput,
  type ServerProbe,
  type ServerProbeResult,
} from "./health-machine"
import { endpointCredentials } from "./machine"
import { ClientError, isUnauthorizedError, OpenCode } from "@opencode/client"
import { Accessor, batch, createComputed, createSignal, onCleanup, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

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

// `at` is when the probe started, then when it answered: a probe that hangs is shared only briefly.
const healthCache = new Map<
  string,
  { at: number; fetch: typeof globalThis.fetch; promise: Promise<ServerProbeResult> }
>()

/** A signal that aborts after a timeout, and how to stop its timer early when one runs. */
type Timeout = { readonly signal: AbortSignal; readonly clear?: () => void }

function timeoutSignal(timeoutMs: number): Timeout {
  // Some runtimes lack `AbortSignal.timeout` or throw from it; a timer stands in.
  if ("timeout" in AbortSignal) {
    try {
      return { signal: AbortSignal.timeout(timeoutMs) }
    } catch {}
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return { signal: controller.signal, clear: () => clearTimeout(timer) }
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

// SAFETY: a rejection's reason is unknown by contract; this is the boundary that classifies it, by `instanceof` only.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
function retryable(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false

  if (error instanceof ClientError) return error.reason === "Transport"

  if (!(error instanceof Error)) return false

  if (error.name === "AbortError" || error.name === "TimeoutError") return false

  if (error instanceof TypeError) return true

  return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

const unreachable = { type: "unreachable" } as const

export async function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerProbeResult> {
  const timeout = opts?.signal ? undefined : timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = opts?.signal ?? timeout?.signal
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs

  const headers = server.password
    ? {
        Authorization: `Basic ${authTokenFromCredentials({ password: server.password })}`,
      }
    : undefined

  const next = (count: number, retry: boolean): Promise<ServerProbeResult> => {
    if (count >= retryCount || !retry) return Promise.resolve(unreachable)

    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch(() => unreachable)
  }

  const attempt = async (count: number): Promise<ServerProbeResult> => {
    const current = await OpenCode.make({
      baseUrl: server.url,
      fetch,
      headers,
    })
      .server.info({ signal })
      .then((status) => ({
        data: { type: "healthy" as const, version: status.version, hostname: status.hostname },
      }))
      .catch((error) => ({ error }))

    if ("data" in current) return current.data

    if (signal?.aborted) return unreachable

    if (isUnauthorizedError(current.error)) return { type: "unauthorized" }

    return next(count, retryable(current.error, signal))
  }

  return attempt(0).finally(() => timeout?.clear?.())
}

export function useCheckServerHealth() {
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  return (http: ServerConnection.HttpBase) => {
    const key = endpointCredentials(http)
    const hit = healthCache.get(key)
    const now = Date.now()

    if (hit && hit.fetch === fetcher && now - hit.at < cacheMs) return hit.promise

    const promise = checkServerHealth(http, fetcher).finally(() => {
      if (healthCache.get(key)?.promise === promise) healthCache.set(key, { at: Date.now(), fetch: fetcher, promise })
    })

    healthCache.set(key, { at: now, fetch: fetcher, promise })

    return promise
  }
}

export const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, onProbe?: (probe: ServerProbe) => void) => {
  return createServerHealth(servers, useCheckServerHealth(), onProbe)
}

export function createServerHealth(
  servers: Accessor<ServerConnection.Any[]>,
  check: (http: ServerConnection.HttpBase) => Promise<ServerProbeResult>,
  onProbe?: (probe: ServerProbe) => void,
) {
  const [machine, setMachine] = createSignal(createServerHealthState())
  const [status, setStatus] = createStore<Record<ServerConnection.Key, ServerHealth | undefined>>({})
  let timer: ReturnType<typeof setInterval> | undefined

  const dispatch = (event: ServerHealthEvent) =>
    batch(() => {
      const prev = untrack(machine)
      const result = transitionServerHealth(prev, event)

      // The selector builds new objects, which the store adopts and later updates in place.
      if (result.state.entries !== prev.entries) setStatus(reconcile(selectServerHealthRecord(result.state)))
      setMachine(result.state)

      result.effects.forEach((effect) => {
        if (effect.type === "probe") {
          const settled = (answer: ServerProbeResult) =>
            dispatch({ type: "probe.settled", key: effect.key, attempt: effect.attempt, result: answer })

          void Promise.try(() => check(effect.http)).then(settled, () => settled(unreachable))

          return
        }

        if (effect.type === "notify.probe") return onProbe?.(effect.probe)

        if (effect.type === "waiters.resolve") return effect.resolvers.forEach((resolve) => resolve())

        clearInterval(timer)
        timer =
          effect.type === "timer.start"
            ? setInterval(() => dispatch({ type: "poll.due" }), effect.intervalMs)
            : undefined
      })
    })

  // Runs during updates, so a server's health is known on the render that lists it. Reading the endpoint here tracks a
  // saved password and a plugin server's stage and endpoint.
  createComputed(() => {
    const list = servers().map(healthInput)

    untrack(() => dispatch({ type: "servers.synced", servers: list }))
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    status,
    /** Probes every server now instead of at the next poll; resolves when each has answered or left the list. */
    retry: () => new Promise<void>((resolve) => dispatch({ type: "retry.requested", resolve })),
  }
}

function healthInput(conn: ServerConnection.Any): ServerHealthInput {
  const key = ServerConnection.key(conn)

  if (conn.type !== "plugin")
    return { type: "endpoint", key, http: { url: conn.http.url, password: conn.http.password }, managed: false }

  if (conn.status.type === "ready") return { type: "endpoint", key, http: conn.status.http, managed: conn.managed }

  return { type: "staged", key, stage: conn.status.type }
}
