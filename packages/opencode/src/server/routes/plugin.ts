import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"
import { withTimeout } from "../../util/timeout"

const bin = () => process.env.PENNYLANE_CLI_BIN || "pennylane"
const requestTimeoutMs = 3000
const processTimeoutMs = 5000
const cacheMs = 5000

const PennylaneHealthCode = z.enum([
  "ok",
  "not_configured",
  "bin_not_found",
  "auth_error",
  "api_error",
  "timeout",
  "invalid_response",
  "spawn_error",
])

const PennylaneHealthSchema = z.object({
  healthy: z.boolean(),
  configured: z.boolean(),
  code: PennylaneHealthCode,
  message: z.string().optional(),
  error: z.string().optional(),
  hint: z.string().optional(),
  details: z.record(z.string(), z.string()).optional(),
  latency_ms: z.number().int().nonnegative().optional(),
})

type PennylaneHealth = z.infer<typeof PennylaneHealthSchema>
type PennylaneHealthCode = z.infer<typeof PennylaneHealthCode>

let cached:
  | {
      at: number
      value: PennylaneHealth
    }
  | undefined
let inflight: Promise<PennylaneHealth> | undefined

function isPennylaneConfigured(plugins: string[]): boolean {
  return plugins.some((p) => {
    const name = Config.getPluginName(p)
    return name === "pennylane" || p.toLowerCase().includes("pennylane")
  })
}

function result(input: Omit<PennylaneHealth, "error">): PennylaneHealth {
  if (!input.healthy && input.message) {
    return {
      ...input,
      error: input.message,
    }
  }
  return input
}

function hint(code: PennylaneHealthCode): string | undefined {
  if (code === "not_configured") return "Add the pennylane plugin to your opencode config."
  if (code === "bin_not_found") return "Install the Pennylane CLI or set PENNYLANE_CLI_BIN to the binary path."
  if (code === "auth_error") return "Set PENNYLANE_API_KEY and run `pennylane health` again."
  if (code === "api_error") return "Run `pennylane health --debug` on this machine to inspect the failing request."
  if (code === "timeout") return "Pennylane health timed out. Run `pennylane health --debug` locally to verify connectivity."
  if (code === "invalid_response" || code === "spawn_error") {
    return "Run `pennylane health --debug` locally and inspect the CLI output."
  }
}

function details(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return
  const entries = Object.entries(input).flatMap(([key, value]) => {
    if (typeof value === "string") return [[key, value] as const]
    if (typeof value === "number" || typeof value === "boolean") return [[key, String(value)] as const]
    return []
  })
  if (!entries.length) return
  return Object.fromEntries(entries)
}

function parse(text: string) {
  if (!text.trim()) return
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== "object") return

  const code = "code" in parsed && typeof parsed.code === "string" ? PennylaneHealthCode.safeParse(parsed.code) : undefined
  const message = "message" in parsed && typeof parsed.message === "string" ? parsed.message : undefined
  const parsedDetails = "details" in parsed ? details(parsed.details) : undefined

  return {
    code: code?.success ? code.data : undefined,
    message,
    details: parsedDetails,
  }
}

function text(stream: number | ReadableStream<Uint8Array<ArrayBuffer>> | undefined) {
  if (!(stream instanceof ReadableStream)) return Promise.resolve("")
  return new Response(stream).text()
}

function failure(input: {
  code: PennylaneHealthCode
  message: string
  latency_ms?: number
  details?: Record<string, string>
}): PennylaneHealth {
  return result({
    healthy: false,
    configured: true,
    code: input.code,
    message: input.message,
    hint: hint(input.code),
    details: input.details,
    latency_ms: input.latency_ms,
  })
}

export async function checkPennylaneHealth(input?: {
  bin?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  request_timeout_ms?: number
  process_timeout_ms?: number
}): Promise<PennylaneHealth> {
  const started = Date.now()
  const cwd = input?.cwd ?? Instance.worktree ?? Instance.directory
  const env = input?.env ?? process.env
  const requestTimeout = input?.request_timeout_ms ?? requestTimeoutMs
  const processTimeout = input?.process_timeout_ms ?? processTimeoutMs

  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([input?.bin ?? bin(), "health", "--timeout", requestTimeout.toString()], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failure({
      code: /enoent|not found|no such file/i.test(message) ? "bin_not_found" : "spawn_error",
      message,
      latency_ms: Date.now() - started,
    })
  }

  const output = Promise.all([text(proc.stdout), text(proc.stderr)]).catch(() => ["", ""] as const)

  let exit: number
  try {
    exit = await withTimeout(proc.exited, processTimeout)
  } catch {
    proc.kill()
    await output
    return failure({
      code: "timeout",
      message: `Pennylane health check timed out after ${processTimeout}ms`,
      latency_ms: Date.now() - started,
    })
  }

  const [out, err] = await output
  const latency_ms = Date.now() - started

  if (exit === 0) {
    return {
      healthy: true,
      configured: true,
      code: "ok",
      latency_ms,
    }
  }

  const raw = err.trim() || out.trim()
  try {
    const parsed = parse(err) ?? parse(out)
    if (parsed?.message) {
      return failure({
        code: parsed.code ?? "spawn_error",
        message: parsed.message,
        details: parsed.details,
        latency_ms,
      })
    }
  } catch {}

  return failure({
    code: raw ? "invalid_response" : "spawn_error",
    message: raw || `pennylane health failed with exit code ${exit}`,
    latency_ms,
  })
}

async function getPennylaneHealth() {
  if (cached && Date.now() - cached.at < cacheMs) return cached.value
  if (inflight) return inflight

  inflight = checkPennylaneHealth()
    .then((value) => {
      cached = {
        at: Date.now(),
        value,
      }
      return value
    })
    .finally(() => {
      inflight = undefined
    })

  return inflight
}

export function resetPennylaneHealthCache() {
  cached = undefined
  inflight = undefined
}

export const PluginRoutes = lazy(() =>
  new Hono()
    .get(
      "/pennylane/health",
      describeRoute({
        summary: "Get Pennylane health",
        description: "Check Pennylane API/CLI connection status. Returns healthy only when the Pennylane plugin is configured and the health check succeeds.",
        operationId: "plugin.pennylane.health",
        responses: {
          200: {
            description: "Pennylane health status",
            content: {
              "application/json": {
                schema: resolver(PennylaneHealthSchema),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        if (!isPennylaneConfigured(plugins)) {
          return c.json(
            result({
              healthy: false,
              configured: false,
              code: "not_configured",
              message: "not configured",
              hint: hint("not_configured"),
            }),
          )
        }

        try {
          return c.json(await getPennylaneHealth())
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json(
            failure({
              code: "spawn_error",
              message,
            }),
          )
        }
      },
    ),
)
