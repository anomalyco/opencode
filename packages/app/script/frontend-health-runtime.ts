/**
 * Shared frontend health probes for production (`server.ts`) and Vite dev (`vite.config.ts`).
 * Mirrors targets used by the Docker frontend image.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

export type HealthCheckResult = {
  name: string
  ok: boolean
  target: string
  detail?: string
  status?: number
  latencyMs: number
}

export type FrontendHealthReport = {
  service: "opencode-frontend"
  ok: boolean
  checks: HealthCheckResult[]
}

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

export function toReadyUrl(base: string) {
  return `${trimTrailingSlash(base)}/readyz`
}

export function relayHttpBaseFromWs(base: string) {
  try {
    const url = new URL(base)
    url.protocol = url.protocol === "wss:" ? "https:" : "http:"
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return base
  }
}

export function toRelayWsHealthUrl(base: string) {
  try {
    const url = new URL(base)
    url.pathname = "/readyz/ws"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return base
  }
}

/** Matches Docker frontend defaults (`opencode-api:3000`) when dev vars are unset. */
export function resolveBackendHealthUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.FRONTEND_BACKEND_HEALTH_URL?.trim()
  if (explicit) return explicit
  const full = env.VITE_OPENCODE_SERVER_URL?.trim()
  if (full) return toReadyUrl(full)
  const h = env.DEV_BACKEND_HOST?.trim()
  const p = env.DEV_BACKEND_PORT?.trim()
  if (h && p) return toReadyUrl(`http://${h}:${p}`)
  return "http://opencode-api:3000/readyz"
}

export function resolveRelayHealthUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.FRONTEND_RELAY_HEALTH_URL?.trim()
  if (explicit) return explicit
  const ws = env.VITE_UNIVER_SDK_WS?.trim()
  if (ws) return toReadyUrl(relayHttpBaseFromWs(ws))
  return "http://relay:8080/readyz"
}

export function resolveRelayWsHealthUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.FRONTEND_RELAY_WS_HEALTH_URL?.trim()
  if (explicit) return explicit
  const ws = env.VITE_UNIVER_SDK_WS?.trim()
  if (ws) return toRelayWsHealthUrl(ws)
  return "ws://relay:8080/readyz/ws"
}

export function healthTimeoutMs(env: NodeJS.ProcessEnv): number {
  return Number(env.VERITLY_HEALTH_TIMEOUT_MS ?? "5000")
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs)
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer)
    },
  }
}

export async function timedHttpCheck(
  name: string,
  target: string,
  timeoutMillis: number,
): Promise<HealthCheckResult> {
  const startedAt = performance.now()
  const timeout = timeoutSignal(timeoutMillis)
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
      signal: timeout.signal,
    })
    return {
      name,
      ok: response.ok,
      target,
      status: response.status,
      detail: response.ok ? "reachable" : `unexpected status ${response.status}`,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch (error) {
    return {
      name,
      ok: false,
      target,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    timeout.done()
  }
}

export async function relayWsCheck(target: string, timeoutMillis: number): Promise<HealthCheckResult> {
  const startedAt = performance.now()
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const socket = new WebSocket(target)

    const finish = (result: Omit<HealthCheckResult, "name" | "target" | "latencyMs">) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "healthcheck complete")
        }
      } catch {
        /* ignore */
      }
      resolve({
        name: "relay-websocket",
        target,
        latencyMs: Math.round(performance.now() - startedAt),
        ...result,
      })
    }

    timer = setTimeout(() => {
      finish({ ok: false, detail: "timed out waiting for relay websocket" })
    }, timeoutMillis)

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        if (payload?.ok === true) {
          finish({ ok: true, detail: "websocket probe succeeded" })
          return
        }
        finish({ ok: false, detail: payload?.error ? String(payload.error) : "unexpected websocket payload" })
      } catch {
        finish({ ok: true, detail: "websocket opened" })
      }
    }

    socket.onerror = () => {
      finish({ ok: false, detail: "websocket error" })
    }

    socket.onclose = (event) => {
      if (settled) return
      finish({
        ok: event.code === 1000,
        detail: event.code === 1000 ? "websocket probe closed cleanly" : `closed with ${event.code}`,
      })
    }
  })
}

export async function staticCheck(appRoot: string): Promise<HealthCheckResult> {
  const target = join(appRoot, "index.html")
  const startedAt = performance.now()
  const ok = existsSync(target)
  return {
    name: "assets",
    ok,
    target,
    detail: ok ? "index.html present" : "index.html missing",
    latencyMs: Math.round(performance.now() - startedAt),
  }
}

/** Same probes as production `server.ts` full report: assets + backend + relay HTTP + relay WS. */
export async function frontendHealthReport(appRoot: string, env: NodeJS.ProcessEnv): Promise<FrontendHealthReport> {
  const t = healthTimeoutMs(env)
  const checks = await Promise.all([
    staticCheck(appRoot),
    timedHttpCheck("backend", resolveBackendHealthUrl(env), t),
    timedHttpCheck("relay-http", resolveRelayHealthUrl(env), t),
    relayWsCheck(resolveRelayWsHealthUrl(env), t),
  ])
  return {
    service: "opencode-frontend",
    ok: checks.every((c) => c.ok),
    checks,
  }
}
