import z from "zod/v4"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"

export namespace EvalOps {
  const log = Log.create({ service: "tool.evalops" })

  export namespace Results {
    export const TestResult = z.object({
      name: z.string(),
      passed: z.boolean(),
      duration: z.number(),
      error: z.string().optional(),
      output: z.string().optional(),
    })

    export const schema = z.object({
      suite: z.string(),
      tests: z.array(TestResult),
      summary: z.object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
        duration: z.number(),
      }),
      timestamp: z.string(),
    })

    export type Type = z.infer<typeof schema>
  }

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
  }

  interface EvalOpsConfig {
    enabled: boolean
    apiUrl?: string
    apiToken?: string
    defaultSuite?: string
    autoRun?: boolean
    telemetry?: boolean
  }

  export async function getConfig(): Promise<EvalOpsConfig> {
    const config = await Config.get()
    return (config as any).evalops ?? {
      enabled: false,
      autoRun: false,
      telemetry: true,
    }
  }

  export async function runEvaluation(
    suite: string,
    context: Tool.Context,
  ): Promise<Results.Type> {
    const config = await getConfig()
    const startTime = Date.now()

    log.info("running evaluation", { suite, sessionID: context.sessionID })

    // Get the current session context
    const session = await Session.get(context.sessionID)
    const messages = await Session.messages(context.sessionID)

    // Prepare the evaluation payload
    const payload = {
      suite,
      sessionID: context.sessionID,
      messageID: context.messageID,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.role === "user" ? msg.parts.map(p => p.text).join("\n") :
                 msg.role === "assistant" ? msg.parts.map(p => {
                   if (p.type === "text") return p.text
                   if (p.type === "tool-use") return `Tool: ${p.name}(${JSON.stringify(p.args)})`
                   if (p.type === "tool-result") return `Result: ${p.output}`
                   return ""
                 }).join("\n") : "",
      })),
      timestamp: new Date().toISOString(),
      project: Instance.directory,
    }

    // Call EvalOps API or run local evaluation
    let results: Results.Type

    if (config.apiUrl) {
      // Call external EvalOps API
      try {
        const response = await fetch(`${config.apiUrl}/evaluate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiToken && { Authorization: `Bearer ${config.apiToken}` }),
          },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          throw new Error(`EvalOps API error: ${response.statusText}`)
        }

        results = await response.json()
      } catch (error) {
        log.error("failed to call EvalOps API", { error })
        throw error
      }
    } else {
      // Run local evaluation
      results = await runLocalEvaluation(suite, payload)
    }

    // Track telemetry if enabled
    if (config.telemetry) {
      await sendTelemetry(results)
    }

    // Emit completion event
    await Bus.emit(Event.TestCompleted, {
      sessionID: context.sessionID,
      messageID: context.messageID,
      results,
    })

    const duration = Date.now() - startTime
    log.info("evaluation completed", {
      suite,
      passed: results.summary.passed,
      failed: results.summary.failed,
      duration,
    })

    return results
  }

  async function runLocalEvaluation(
    suite: string,
    payload: any,
  ): Promise<Results.Type> {
    // Look for evaluation scripts in .opencode/evaluations/
    const evalDir = path.join(Instance.directory, ".opencode", "evaluations")
    const suiteFile = path.join(evalDir, `${suite}.js`)

    try {
      await fs.access(suiteFile)
    } catch {
      throw new Error(`Evaluation suite '${suite}' not found at ${suiteFile}`)
    }

    // Run the evaluation script
    const proc = spawn("bun", ["run", suiteFile], {
      cwd: Instance.directory,
      env: {
        ...process.env,
        EVALOPS_PAYLOAD: JSON.stringify(payload),
      },
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
          reject(new Error(`Evaluation failed: ${errorOutput}`))
          return
        }

        try {
          const results = JSON.parse(output)
          resolve(results)
        } catch (error) {
          reject(new Error(`Failed to parse evaluation results: ${error}`))
        }
      })
    })
  }

  async function sendTelemetry(results: Results.Type) {
    // Send telemetry data to EvalOps for aggregation
    const config = await getConfig()
    if (config.apiUrl && config.apiToken) {
      try {
        await fetch(`${config.apiUrl}/telemetry`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify({
            results,
            project: Instance.directory,
            timestamp: new Date().toISOString(),
          }),
        })
      } catch (error) {
        log.warn("failed to send telemetry", { error })
      }
    }
  }

  export async function shouldAutoRun(sessionID: string): Promise<boolean> {
    const config = await getConfig()
    if (!config.enabled || !config.autoRun) return false

    // Check if there's a default suite configured
    return !!config.defaultSuite
  }

  export async function autoRun(sessionID: string, messageID: string) {
    const config = await getConfig()
    if (!config.defaultSuite) return

    log.info("auto-running evaluation", {
      sessionID,
      messageID,
      suite: config.defaultSuite
    })

    try {
      const context: Tool.Context = {
        sessionID,
        messageID,
        agent: "evalops",
        abort: new AbortController().signal,
        metadata: () => {},
      }

      await runEvaluation(config.defaultSuite, context)
    } catch (error) {
      log.error("auto-run evaluation failed", { error })
    }
  }
}

export const EvalOpsTool = Tool.define(
  "evalops",
  {
    description: "Run EvalOps evaluation suite to test code quality, performance, and correctness",
    parameters: z.object({
      suite: z.string().describe("The evaluation suite to run"),
      options: z
        .object({
          timeout: z.number().optional().describe("Timeout in milliseconds"),
          parallel: z.boolean().optional().describe("Run tests in parallel"),
          filter: z.string().optional().describe("Filter tests by pattern"),
        })
        .optional(),
    }),
    async execute(args, ctx) {
      const config = await EvalOps.getConfig()

      if (!config.enabled) {
        return {
          title: "EvalOps Disabled",
          output: "EvalOps is not enabled. Set evalops.enabled to true in your configuration.",
          metadata: {},
        }
      }

      // Emit start event
      await Bus.emit(EvalOps.Event.TestStarted, {
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        suite: args.suite,
        tests: [], // Will be populated by the evaluation suite
      })

      try {
        const results = await EvalOps.runEvaluation(args.suite, ctx)

        // Format output
        const output = formatResults(results)

        return {
          title: `EvalOps: ${args.suite}`,
          output,
          metadata: {
            results,
            suite: args.suite,
            passed: results.summary.passed === results.summary.total,
          },
        }
      } catch (error) {
        return {
          title: `EvalOps Failed: ${args.suite}`,
          output: `Evaluation failed: ${error.message}`,
          metadata: {
            error: error.message,
            suite: args.suite,
            passed: false,
          },
        }
      }
    },
  },
)

function formatResults(results: EvalOps.Results.Type): string {
  const { summary, tests } = results
  const passRate = ((summary.passed / summary.total) * 100).toFixed(1)

  let output = `## Evaluation Results: ${results.suite}\n\n`
  output += `**Summary:** ${summary.passed}/${summary.total} passed (${passRate}%)\n`
  output += `**Duration:** ${summary.duration}ms\n\n`

  output += `### Test Results\n\n`

  for (const test of tests) {
    const icon = test.passed ? "✅" : "❌"
    output += `${icon} **${test.name}** (${test.duration}ms)\n`

    if (!test.passed && test.error) {
      output += `   Error: ${test.error}\n`
    }

    if (test.output) {
      output += `   Output: ${test.output.slice(0, 200)}${test.output.length > 200 ? "..." : ""}\n`
    }

    output += `\n`
  }

  return output
}