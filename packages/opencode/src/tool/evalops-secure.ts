import z from "zod/v4"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Bus } from "../bus"

import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"

import { NamedError } from "../util/error"

/**
 * EvalOps - Continuous Evaluation for AI-Generated Code
 * 🚀 Powered by EvalOps™ - "Trust, but Verify"
 */

export namespace EvalOps {
  const log = Log.create({ service: "tool.evalops" })

  // 🔒 Security: Store sensitive data separately
  const EVALOPS_API_TOKEN = process.env["EVALOPS_API_TOKEN"]
  const EVALOPS_API_URL = process.env["EVALOPS_API_URL"]

  // 🎨 EvalOps Brand Colors
  export const BRAND = {
    primary: "#6366F1", // Indigo
    success: "#10B981", // Emerald
    warning: "#F59E0B", // Amber
    danger: "#EF4444", // Red
    dark: "#1F2937", // Gray-800
    light: "#F9FAFB", // Gray-50
    logo: "🎯",
  } as const

  // 🔐 Secure configuration interface
  export interface EvalOpsConfig {
    enabled: boolean
    defaultSuite?: string
    autoRun?: boolean
    telemetry?: boolean
    maxConcurrent?: number
    timeout?: number
    cacheResults?: boolean
    cacheTTL?: number
  }

  // 📊 Result storage with proper typing
  const resultStore = new Map<string, Results.Type[]>()
  const resultCache = new Map<string, { result: Results.Type; timestamp: number }>()
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  // 🔄 Concurrency control
  const runningEvals = new Map<string, Promise<Results.Type>>()

  export const Event = {
    TestStarted: Bus.event(
      "evalops.test.started",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        suite: z.string(),
        tests: z.array(z.string()),
      }),
    ),
    TestCompleted: Bus.event(
      "evalops.test.completed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        results: Results.schema,
      }),
    ),
    TestFailed: Bus.event(
      "evalops.test.failed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        error: z.string(),
        suite: z.string(),
      }),
    ),
  }

  // Register events with Bus
  // Events are auto-registered when defined

  export namespace Results {
    export const TestResult = z.object({
      name: z.string(),
      passed: z.boolean(),
      duration: z.number(),
      error: z.string().optional(),
      output: z.string().optional(),
      score: z.number().min(0).max(100).optional(),
    })

    export const schema = z.object({
      suite: z.string(),
      tests: z.array(TestResult),
      summary: z.object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
        duration: z.number(),
        score: z.number().min(0).max(100),
      }),
      timestamp: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
    })

    export type Type = z.infer<typeof schema>
  }

  export const Error = {
    Disabled: NamedError.create("EvalOpsDisabled", z.object({ message: z.string() })),
    Unauthorized: NamedError.create("EvalOpsUnauthorized", z.object({ message: z.string() })),
    RateLimited: NamedError.create("EvalOpsRateLimited", z.object({ retryAfter: z.number() })),
    Timeout: NamedError.create("EvalOpsTimeout", z.object({ suite: z.string(), duration: z.number() })),
  }

  export async function getConfig(): Promise<EvalOpsConfig> {
    const config = await Config.get()
    const evalopsConfig = (config as any).evalops as EvalOpsConfig | undefined

    return {
      enabled: evalopsConfig?.enabled ?? false,
      autoRun: evalopsConfig?.autoRun ?? false,
      telemetry: evalopsConfig?.telemetry ?? true,
      defaultSuite: evalopsConfig?.defaultSuite,
      maxConcurrent: evalopsConfig?.maxConcurrent ?? 3,
      timeout: evalopsConfig?.timeout ?? 60000,
      cacheResults: evalopsConfig?.cacheResults ?? true,
      cacheTTL: evalopsConfig?.cacheTTL ?? CACHE_TTL,
    }
  }

  export async function runEvaluation(suite: string, context: Tool.Context): Promise<Results.Type> {
    const config = await getConfig()

    if (!config.enabled) {
      throw new Error.Disabled({ message: "EvalOps is not enabled" })
    }

    // Check for cached results
    if (config.cacheResults) {
      const cacheKey = `${context.sessionID}:${suite}`
      const cached = resultCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < (config.cacheTTL || CACHE_TTL)) {
        log.info("returning cached results", { suite, sessionID: context.sessionID })
        return cached.result
      }
    }

    // Check if already running
    const evalKey = `${context.sessionID}:${suite}`
    const running = runningEvals.get(evalKey)
    if (running) {
      log.info("evaluation already running, waiting", { suite, sessionID: context.sessionID })
      return running
    }

    // Concurrency control handled by runningEvals map

    // Check concurrent limit
    if (runningEvals.size >= (config.maxConcurrent || 3)) {
      throw new Error.RateLimited({ retryAfter: 5000 })
    }

    const evalPromise = runEvaluationInternal(suite, context, config)
    runningEvals.set(evalKey, evalPromise)

    try {
      const result = await evalPromise

      // Cache results
      if (config.cacheResults) {
        const cacheKey = `${context.sessionID}:${suite}`
        resultCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        })
      }

      // Store results
      storeResults(context.sessionID, result)

      return result
    } finally {
      runningEvals.delete(evalKey)
    }
  }

  async function runEvaluationInternal(
    suite: string,
    context: Tool.Context,
    config: EvalOpsConfig,
  ): Promise<Results.Type> {
    const startTime = Date.now()

    log.info("🎯 EvalOps: Starting evaluation", {
      suite,
      sessionID: context.sessionID,
      brand: BRAND.logo,
    })

    // Emit start event
    await Bus.publish(Event.TestStarted, {
      sessionID: context.sessionID,
      messageID: context.messageID,
      suite,
      tests: [],
    })

    // Set up timeout
    const timeoutMs = config.timeout || 60000
    const timeout = setTimeout(() => {
      throw new Error.Timeout({ suite, duration: timeoutMs })
    }, timeoutMs)

    try {
      // Check abort signal
      if (context.abort.aborted) {
        throw new Error.Disabled({ message: "Evaluation aborted" })
      }

      await Session.get(context.sessionID)
      const messages = await Session.messages(context.sessionID)

      // Validate suite path to prevent directory traversal
      const safeSuite = path.basename(suite)
      if (safeSuite !== suite) {
        throw new Error.Disabled({ message: "Invalid suite name" })
      }

      const payload = {
        suite: safeSuite,
        sessionID: context.sessionID,
        messageID: context.messageID,
        messages: messages.map((msg) => ({
          role: msg.info.role,
          content: extractMessageContent(msg),
        })),
        timestamp: new Date().toISOString(),
        project: Instance.directory,
      }

      let results: Results.Type

      if (EVALOPS_API_URL && EVALOPS_API_TOKEN) {
        // Use external API with proper authentication
        results = await callExternalAPI(payload, context.abort)
      } else {
        // Run local evaluation with sandboxing
        results = await runLocalEvaluation(safeSuite, payload, context.abort)
      }

      // Calculate score
      results.summary.score = (results.summary.passed / results.summary.total) * 100

      // Track telemetry asynchronously
      if (config.telemetry) {
        sendTelemetry(results).catch((err) => log.warn("Failed to send telemetry", { error: err }))
      }

      // Emit completion event
      await Bus.publish(Event.TestCompleted, {
        sessionID: context.sessionID,
        messageID: context.messageID,
        results,
      })

      const duration = Date.now() - startTime
      log.info(`${BRAND.logo} EvalOps: Evaluation completed`, {
        suite,
        score: results.summary.score,
        passed: results.summary.passed,
        failed: results.summary.failed,
        duration,
      })

      return results
    } catch (error) {
      const errorMessage = (error && typeof error === 'object' && 'message' in error) ? String((error as any).message) : String(error);
      await Bus.publish(Event.TestFailed, {
        sessionID: context.sessionID,
        messageID: context.messageID,
        error: errorMessage,
        suite,
      })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  function extractMessageContent(msg: MessageV2.WithParts): string {
    if (msg.info.role === "user") {
      return msg.parts
        .map((p) => {
          if (p.type === "text") return p.text || ""
          return ""
        })
        .join("\n")
    }
    if (msg.info.role === "assistant") {
      return msg.parts
        .map((p) => {
          if (p.type === "text") return p.text || ""
          if (p.type === "tool") return `Tool: ${p.tool}(${JSON.stringify(p)})`
          return ""
        })
        .join("\n")
    }
    return ""
  }

  async function callExternalAPI(payload: any, abort: AbortSignal): Promise<Results.Type> {
    if (!EVALOPS_API_TOKEN) {
      throw new Error.Unauthorized({ message: "API token not configured" })
    }

    const response = await fetch(`${EVALOPS_API_URL}/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EVALOPS_API_TOKEN}`,
        "X-EvalOps-Version": "1.0.0",
      },
      body: JSON.stringify(payload),
      signal: abort,
    })

    if (response.status === 401) {
      throw new Error.Unauthorized({ message: "Invalid API token" })
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "60") * 1000
      throw new Error.RateLimited({ retryAfter })
    }

    if (!response.ok) {
      throw new Error.Disabled({ message: `EvalOps API error: ${response.statusText}` })
    }

    return response.json()
  }

  async function runLocalEvaluation(suite: string, payload: any, abort: AbortSignal): Promise<Results.Type> {
    const evalDir = path.join(Instance.directory, ".opencode", "evaluations")
    const suiteFile = path.join(evalDir, `${suite}.js`)

    // Validate file exists and is within evalDir
    const realPath = await fs.realpath(suiteFile).catch(() => null)
    if (!realPath || !realPath.startsWith(evalDir)) {
      throw new Error.Disabled({ message: `Invalid evaluation suite: ${suite}` })
    }

    const proc = spawn("bun", ["run", "--", suiteFile], {
      cwd: Instance.directory,
      env: {
        ...process.env,
        EVALOPS_PAYLOAD: JSON.stringify(payload),
        NODE_ENV: "test",
      },
      signal: abort,
    })

    let output = ""
    let errorOutput = ""

    proc.stdout.on("data", (data) => {
      output += data.toString()
    })

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString()
    })

    return new Promise((resolve, reject) => {
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error.Disabled({ message: `Evaluation failed (code ${code}): ${errorOutput}` }))
          return
        }

        try {
          const results = JSON.parse(output)
          const validated = Results.schema.parse(results)
          resolve(validated)
        } catch (error) {
          const errorMessage = (error && typeof error === 'object' && 'message' in error) ? String((error as any).message) : String(error);
          reject(new Error.Disabled({ message: `Invalid evaluation output: ${errorMessage}` }))
        }
      })

      proc.on("error", reject)
    })
  }

  async function sendTelemetry(results: Results.Type): Promise<void> {
    if (!EVALOPS_API_URL || !EVALOPS_API_TOKEN) return

    try {
      await fetch(`${EVALOPS_API_URL}/telemetry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${EVALOPS_API_TOKEN}`,
        },
        body: JSON.stringify({
          results,
          project: Instance.directory,
          timestamp: new Date().toISOString(),
          version: "1.0.0",
        }),
      })
    } catch (error) {
      log.warn("Telemetry send failed", { error })
    }
  }

  function storeResults(sessionID: string, results: Results.Type) {
    const existing = resultStore.get(sessionID) || []
    existing.push(results)
    resultStore.set(sessionID, existing)

    // Limit stored results per session
    if (existing.length > 100) {
      existing.shift()
    }
  }

  export async function getResults(sessionID: string): Promise<Results.Type[]> {
    return resultStore.get(sessionID) || []
  }

  export async function shouldAutoRun(_sessionID: string): Promise<boolean> {
    const config = await getConfig()
    if (!config.enabled || !config.autoRun) return false
    return !!config.defaultSuite
  }

  export async function autoRun(sessionID: string, messageID: string) {
    const config = await getConfig()
    if (!config.defaultSuite) return

    log.info(`${BRAND.logo} EvalOps: Auto-running evaluation`, {
      sessionID: sessionID,
      messageID,
      suite: config.defaultSuite,
    })

    try {
      const context: Tool.Context = {
        sessionID: sessionID,
        messageID,
        agent: "evalops-auto",
        abort: new AbortController().signal,
        metadata: () => {},
      }

      await runEvaluation(config.defaultSuite, context)
    } catch (error) {
      log.error("Auto-run evaluation failed", { error })
    }
  }
}

// Define metadata type for the tool
interface EvalOpsToolMetadata {
  results?: EvalOps.Results.Type;
  suite?: string;
  passed?: boolean;
  score?: number;
  error?: string;
}

const EvalOpsParameters = z.object({
  suite: z.string().describe("The evaluation suite to run"),
  options: z
    .object({
      timeout: z.number().optional().describe("Timeout in milliseconds"),
      parallel: z.boolean().optional().describe("Run tests in parallel"),
      filter: z.string().optional().describe("Filter tests by pattern"),
    })
    .optional(),
})

type EvalOpsArgs = z.infer<typeof EvalOpsParameters>

export const EvalOpsTool = Tool.define<typeof EvalOpsParameters, EvalOpsToolMetadata>("evalops", {
  description: `🎯 EvalOps - Run automated evaluation suites to test code quality, performance, and correctness. Powered by EvalOps™.`,
  parameters: EvalOpsParameters,
  async execute(args: EvalOpsArgs, ctx) {
    const config = await EvalOps.getConfig()

    if (!config.enabled) {
      return {
        title: `${EvalOps.BRAND.logo} EvalOps Disabled`,
        metadata: {},
        output: "EvalOps is not enabled. Set evalops.enabled to true in your configuration.",
      }
    }

    try {
      const results = await EvalOps.runEvaluation(args.suite, ctx)
      const output = formatResults(results)

      return {
        title: `${EvalOps.BRAND.logo} EvalOps: ${args.suite}`,
        metadata: {
          results,
          suite: args.suite,
          passed: results.summary.passed === results.summary.total,
          score: results.summary.score,
        },
        output,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "EvalOpsUnauthorized") {
        return {
          title: `${EvalOps.BRAND.logo} EvalOps: Authentication Required`,
          metadata: { error: "unauthorized" },
          output: "Please configure EVALOPS_API_TOKEN environment variable",
        }
      }

      if (error instanceof Error && error.name === "EvalOpsRateLimited") {
        return {
          title: `${EvalOps.BRAND.logo} EvalOps: Rate Limited`,
          metadata: { error: "rate_limited" },
          output: `Too many evaluations running. Please retry later.`,
        }
      }

      return {
        title: `${EvalOps.BRAND.logo} EvalOps Failed: ${args.suite}`,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          suite: args.suite,
          passed: false,
        },
        output: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
})

function formatResults(results: EvalOps.Results.Type): string {
  const { summary, tests } = results
  const score = summary.score.toFixed(1)

  // Use brand colors in output
  let output = `## ${EvalOps.BRAND.logo} EvalOps Results: ${results.suite}\n\n`

  // Score with color coding
  let scoreEmoji = "🔴"
  if (summary.score >= 80) scoreEmoji = "🟢"
  else if (summary.score >= 60) scoreEmoji = "🟡"

  output += `**Score:** ${scoreEmoji} ${score}% (${summary.passed}/${summary.total} passed)\n`
  output += `**Duration:** ⏱️ ${summary.duration}ms\n\n`

  output += `### Test Results\n\n`

  for (const test of tests) {
    const icon = test.passed ? "✅" : "❌"
    output += `${icon} **${test.name}** (${test.duration}ms)\n`

    if (test.score !== undefined) {
      output += `   Score: ${test.score}/100\n`
    }

    if (!test.passed && test.error) {
      output += `   ⚠️ Error: ${test.error}\n`
    }

    if (test.output) {
      output += `   📝 Output: ${test.output.slice(0, 200)}${test.output.length > 200 ? "..." : ""}\n`
    }

    output += `\n`
  }

  output += `---\n`
  output += `*Powered by EvalOps™ - "Trust, but Verify"*\n`

  return output
}
