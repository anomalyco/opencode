import { usePlatform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { createSdkForServer } from "./server"

export type ServerHealth = { healthy: boolean; version?: string; message?: string }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
  retryCount?: number
  retryDelayMs?: number
}

const defaultTimeoutMs = 3000
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
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error instanceof TypeError) return true
  return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

function detail(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    if (typeof error === "string" && error.trim()) return error
    return
  }
  const obj = error as Record<string, unknown>
  const direct = [obj.message, obj.detail].find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
  if (direct) return direct
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>
    const nested = [data.message, data.detail].find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    )
    if (nested) return nested
  }
  if (obj.error && typeof obj.error === "object") return detail(obj.error)
  if (obj.cause && typeof obj.cause === "object") return detail(obj.cause)
  return
}

export async function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  const timeout = opts?.signal ? undefined : timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = opts?.signal ?? timeout?.signal
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs
  const next = (count: number, error: unknown) => {
    if (count >= retryCount || !retryable(error, signal)) {
      return Promise.resolve({ healthy: false, message: detail(error) } as const)
    }
    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch(() => ({ healthy: false, message: detail(error) }))
  }
  const attempt = (count: number): Promise<ServerHealth> =>
    createSdkForServer({
      server,
      fetch,
      signal,
    })
      .global.health()
      .then((x) =>
        x.error
          ? next(count, x.error)
          : { healthy: x.data?.healthy === true, version: x.data?.version, message: undefined },
      )
      .catch((error) => next(count, error))
  return attempt(0).finally(() => timeout?.clear?.())
}

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
