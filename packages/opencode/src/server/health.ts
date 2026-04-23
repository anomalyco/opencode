
import { Log } from "@/util/log"
import { SystemPrompt } from "../session/system"
import { getPool } from "../storage/db.pg"
import { Executor } from "@/executor/sdk"

const log = Log.create({ service: "server.health" })

const DEFAULT_TIMEOUT_MS = Number(process.env.VERITLY_HEALTH_TIMEOUT_MS ?? "5000")

export type HealthCheckResult = {
  name: string
  ok: boolean
  target?: string
  detail?: string
  status?: number
  latencyMs: number
}

export type ApiHealthReport = {
  service: "opencode-api"
  ok: boolean
  version: string
  checks: HealthCheckResult[]
}

function now() {
  return performance.now()
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs)
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer)
    },
  }
}

async function timedCheck(
  name: string,
  target: string | undefined,
  fn: (signal: AbortSignal) => Promise<{ ok: boolean; detail?: string; status?: number }>,
): Promise<HealthCheckResult> {
  const startedAt = now()
  const timeout = withTimeout(DEFAULT_TIMEOUT_MS)
  try {
    const result = await fn(timeout.signal)
    return {
      name,
      ok: result.ok,
      target,
      detail: result.detail,
      status: result.status,
      latencyMs: Math.round(now() - startedAt),
    }
  } catch (error) {
    return {
      name,
      ok: false,
      target,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(now() - startedAt),
    }
  } finally {
    timeout.done()
  }
}

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "")
}

function localDev() {
  return !!process.env.DEV_BACKEND_HOST?.trim()
}

/** `http(s)://.../health` from VITE_UNIVER_SDK_WS; relay serves this in `packages/relay/server.ts`. */
function relayHttpHealthFromViteUniverSdkWs(): string | undefined {
  const ws = process.env.VITE_UNIVER_SDK_WS?.trim()
  if (!ws) return undefined
  try {
    const url = new URL(ws)
    url.protocol = url.protocol === "wss:" ? "https:" : "http:"
    url.pathname = "/health"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return undefined
  }
}

function executorUrl() {
  const explicit = process.env.VERITLY_EXECUTOR_URL?.trim()
  if (explicit) return explicit
  if (explicit === "") return undefined
  return undefined
}

function univerHealthTargets() {
  const raw = process.env.VERITLY_HEALTH_UNIVER_URL?.trim() || process.env.VITE_UNIVER_BACKEND_URL?.trim()
  if (!raw) return []

  const base = normalizeBaseUrl(raw)
  return [`${base}/healthz`, `${base}/universer-api/license/key`, `${base}/health`]
}

async function checkDatabase() {
  return timedCheck("database", process.env.DATABASE_URL, async () => {
    await getPool().query("SELECT 1")
    return { ok: true, detail: "postgres reachable" }
  })
}

async function checkHttpTarget(name: string, target: string) {
  return timedCheck(name, target, async (signal) => {
    const response = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
      signal,
    })
    const ok = response.ok
    return {
      ok,
      status: response.status,
      detail: ok ? "reachable" : `unexpected status ${response.status}`,
    }
  })
}

async function checkOptionalRelay() {
  const explicit = process.env.VERITLY_HEALTH_RELAY_URL?.trim()
  if (explicit) {
    return checkHttpTarget("relay", explicit)
  }
  const target = relayHttpHealthFromViteUniverSdkWs()
  if (!target) {
    return {
      name: "relay",
      ok: true,
      detail: "skipped (relay url not configured)",
      latencyMs: 0,
    } satisfies HealthCheckResult
  }
  return checkHttpTarget("relay", target)
}

export function instructionCheck(): HealthCheckResult {
  const text = SystemPrompt.hosted().join("\n")
  if (!text) {
    return {
      name: "instructions",
      ok: true,
      detail: "skipped (hosted executor instructions not required)",
      latencyMs: 0,
    }
  }

  const miss = ["$WORKSPACE", "veritly_univer_sdk", "UniverSDK"].filter((item) => !text.includes(item))
  return {
    name: "instructions",
    ok: miss.length === 0,
    detail: miss.length ? `missing hosted instructions: ${miss.join(", ")}` : "executor/univer instructions present",
    latencyMs: 0,
  }
}

// Initialize executor SDK for health checks
let executorHealthClient: ReturnType<typeof Executor.create> | null = null
function getExecutorHealthClient() {
  if (!executorHealthClient) {
    const url = executorUrl()
    if (!url) return null
    executorHealthClient = Executor.create({ baseUrl: url })
  }
  return executorHealthClient
}

async function checkExecutor() {
  const target = executorUrl()
  if (!target) {
    return {
      name: "executor",
      ok: true,
      detail: "skipped (executor url not configured)",
      latencyMs: 0,
    } satisfies HealthCheckResult
  }

  return timedCheck("executor", target, async () => {
    const client = getExecutorHealthClient()
    if (!client) {
      return {
        ok: false,
        detail: "failed to initialize executor SDK",
      }
    }

    // Check health via SDK
    const healthy = await client.isAvailable()
    if (!healthy) {
      return {
        ok: false,
        detail: "executor health check failed",
      }
    }

    if (localDev()) {
      return {
        ok: true,
        detail: "executor reachable",
      }
    }

    // Now test Python3 and Univer SDK via executor
    const id = `health-${Date.now()}`
    try {
      const result = await client.exec(
        id,
        "python3 --version && python3 -c 'from veritly_univer_sdk import UniverSDK; print(\"Univer SDK OK\")'",
        30000
      )

      if (result.exitCode !== 0) {
        return {
          ok: false,
          detail: `python/univer sdk check failed: ${result.output}`,
        }
      }

      // Verify output contains expected strings
      const output = result.output || ""
      if (!output.includes("Python 3")) {
        return {
          ok: false,
          detail: "python not available in executor",
        }
      }

      if (!output.includes("Univer SDK OK")) {
        return {
          ok: false,
          detail: "univer sdk not available in executor",
        }
      }

      return {
        ok: true,
        detail: `executor healthy, mode: ${result.mode || "unknown"}`,
      }
    } catch (error: any) {
      return {
        ok: false,
        detail: `executor check failed: ${error.message}`,
      }
    }
  })
}

async function checkOptionalUniver() {
  const targets = univerHealthTargets()
  if (!targets.length) {
    return {
      name: "univer",
      ok: true,
      detail: "skipped (univer url not configured)",
      latencyMs: 0,
    } satisfies HealthCheckResult
  }

  for (const target of targets) {
    const result = await checkHttpTarget("univer", target)
    if (result.ok) return result
    log.warn("univer health target failed", {
      target,
      status: result.status,
      detail: result.detail,
    })
  }

  return {
    name: "univer",
    ok: false,
    target: targets[0],
    detail: "all univer health targets failed",
    latencyMs: 0,
  }
}

// Simple health check for orchestrators (Kubernetes) - just database
export async function apiHealthReportSimple(): Promise<ApiHealthReport> {
  const checks = await Promise.all([checkDatabase()])
  return {
    service: "opencode-api",
    ok: checks.every((check) => check.ok),
    version: process.env.OPENCODE_VERSION ?? "dev",
    checks,
  }
}

// Comprehensive health check including all dependencies
export async function apiHealthReport(): Promise<ApiHealthReport> {
  const checks = await Promise.all([
    checkDatabase(),
    checkOptionalUniver(),
    checkOptionalRelay(),
    checkExecutor(),
    Promise.resolve(instructionCheck()),
  ])
  return {
    service: "opencode-api",
    ok: checks.every((check) => check.ok),
    version: process.env.OPENCODE_VERSION ?? "dev",
    checks,
  }
}

export function isPublicHealthPath(path: string) {
  return path === "/health" || path === "/healthz" || path === "/livez" || path === "/global/health"
}
