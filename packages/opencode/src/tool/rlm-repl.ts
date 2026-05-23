import vm from "node:vm"
import { Cause, Effect, Exit, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { EffectBridge } from "@/effect/bridge"
import type { TaskPromptOps } from "./task"

const log = Log.create({ service: "rlm-repl" })

const DESCRIPTION = `Execute JavaScript code with access to sub-LLM calls for recursive processing.

This experimental tool enables the Recursive Language Model (RLM) pattern: writing code that
programmatically invokes sub-LLM calls in loops rather than requiring explicit tool calls for each invocation.

Available functions:
- sub_llm(prompt, agent?) - invoke a sub-LLM call and return its text result
- sub_llm_parallel(prompts[], agent?) - invoke multiple sub-LLM calls in parallel
- context.store(key, data) - store data outside the visible LLM context
- context.load(key) - load stored data by key
- context.chunk(key, chunkSize) - split stored data into chunks and return chunk keys
- context.keys() - list stored keys

Security and resource limits:
- Code runs in a vm context with dynamic code generation disabled
- Maximum 50 sub_llm calls per execution
- 5 minute wall-clock timeout on total execution
- Context store is limited to 10MB total
- Sub-agent sessions cannot use task, rlm_repl, todowrite, or todoread
`

const Parameters = Schema.Struct({
  code: Schema.String.annotate({ description: "JavaScript code to execute. Use a return statement for output." }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Default agent for sub_llm calls. Defaults to build.",
  }),
})

type Metadata = {
  subLLMCalls: number
  executionTimeMs: number
  contextKeys: string[]
  error?: string
}

class RLMContext {
  private readonly values = new Map<string, string>()
  private totalSize = 0
  private readonly maxSize = 10 * 1024 * 1024

  store(key: string, data: unknown) {
    const text = typeof data === "string" ? data : JSON.stringify(data)
    if (this.values.has(key)) this.totalSize -= this.values.get(key)?.length ?? 0
    if (this.totalSize + text.length > this.maxSize) {
      throw new Error(`Context store limit exceeded (max ${this.maxSize / 1024 / 1024}MB)`)
    }
    this.values.set(key, text)
    this.totalSize += text.length
    return key
  }

  load(key: string) {
    return this.values.get(key)
  }

  chunk(key: string, chunkSize: number) {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("chunkSize must be a positive integer")
    const data = this.values.get(key)
    if (data === undefined) throw new Error(`Key not found: ${key}`)
    const keys: string[] = []
    for (let index = 0; index < data.length; index += chunkSize) {
      const chunkKey = `${key}_chunk_${keys.length}`
      this.store(chunkKey, data.slice(index, index + chunkSize))
      keys.push(chunkKey)
    }
    return keys
  }

  keys() {
    return Array.from(this.values.keys())
  }
}

function textOutput(value: unknown) {
  if (typeof value === "string") return value
  if (value === undefined) return "(no return value)"
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function timeoutPromise<T>(input: { promise: Promise<T>; timeoutMs: number; signal: AbortSignal }) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Execution timeout exceeded (5 minutes)")), input.timeoutMs)
  })
  const abort = new Promise<never>((_, reject) => {
    if (input.signal.aborted) reject(new Error("Execution aborted"))
    input.signal.addEventListener("abort", () => reject(new Error("Execution aborted")), { once: true })
  })
  return Promise.race([input.promise, timeout, abort]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export const RLMReplTool = Tool.define(
  "rlm_repl",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const bridge = yield* EffectBridge.make()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const defaultAgent = params.agent ?? "build"
          const rlmContext = new RLMContext()
          const start = Date.now()
          const maxExecutionTime = 5 * 60 * 1000
          const maxSubLLMCalls = 50
          let subLLMCalls = 0

          const metadata = (error?: string): Metadata => ({
            ...(error ? { error } : {}),
            subLLMCalls,
            executionTimeMs: Date.now() - start,
            contextKeys: rlmContext.keys(),
          })

          const checkTimeout = () => {
            if (Date.now() - start > maxExecutionTime) throw new Error("Execution timeout exceeded (5 minutes)")
          }

          const subLLM = async (prompt: string, agent?: string): Promise<string> => {
            checkTimeout()
            subLLMCalls++
            if (subLLMCalls > maxSubLLMCalls) throw new Error(`Maximum sub_llm calls exceeded (${maxSubLLMCalls})`)
            const agentName = agent ?? defaultAgent
            const info = await bridge.promise(agents.get(agentName))
            if (!info) throw new Error(`Unknown agent: ${agentName}`)
            const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
            if (!ops) throw new Error("rlm_repl requires promptOps in tool context for sub_llm calls")

            log.info("sub_llm call", { callNumber: subLLMCalls, agent: agentName, promptLength: prompt.length })
            const child = await bridge.promise(
              sessions.create({
                parentID: ctx.sessionID,
                title: `RLM sub-call #${subLLMCalls}`,
                agent: agentName,
                permission: [
                  { permission: "task", pattern: "*", action: "deny" as const },
                  { permission: "rlm_repl", pattern: "*", action: "deny" as const },
                  { permission: "todowrite", pattern: "*", action: "deny" as const },
                  { permission: "todoread", pattern: "*", action: "deny" as const },
                ],
              }),
            )
            const result = await bridge.promise(
              ops.prompt({
                messageID: MessageID.ascending(),
                sessionID: child.id,
                agent: agentName,
                parts: [{ type: "text", text: prompt }],
              }),
            )
            return result.parts.findLast((part): part is MessageV2.TextPart => part.type === "text")?.text ?? ""
          }

          const subLLMParallel = async (prompts: string[], agent?: string): Promise<string[]> => {
            checkTimeout()
            if (subLLMCalls + prompts.length > maxSubLLMCalls) {
              throw new Error(
                `Would exceed maximum sub_llm calls (${maxSubLLMCalls}). Current: ${subLLMCalls}, Requested: ${prompts.length}`,
              )
            }
            return Promise.all(prompts.map((prompt) => subLLM(prompt, agent)))
          }

          const sandbox = {
            sub_llm: subLLM,
            sub_llm_parallel: subLLMParallel,
            context: {
              store: (key: string, data: unknown) => rlmContext.store(key, data),
              load: (key: string) => rlmContext.load(key),
              chunk: (key: string, chunkSize: number) => rlmContext.chunk(key, chunkSize),
              keys: () => rlmContext.keys(),
            },
            console: {
              log: (...args: unknown[]) => log.info("rlm_repl console.log", { args }),
              error: (...args: unknown[]) => log.error("rlm_repl console.error", { args }),
              warn: (...args: unknown[]) => log.info("rlm_repl console.warn", { args }),
            },
            JSON,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Date,
            Math,
            Promise,
            Map,
            Set,
            RegExp,
            Error,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            encodeURIComponent,
            decodeURIComponent,
            setTimeout: undefined,
            setInterval: undefined,
            fetch: undefined,
            require: undefined,
            eval: undefined,
            Function: undefined,
            process: undefined,
          }

          try {
            const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
            const wrapped = `"use strict"; (async () => {\n${params.code}\n})()`
            const evaluated = vm.runInContext(wrapped, context, { timeout: 1_000 }) as unknown
            const exit = yield* Effect.exit(
              Effect.tryPromise({
                try: () =>
                  timeoutPromise({
                    promise: Promise.resolve(evaluated),
                    timeoutMs: maxExecutionTime,
                    signal: ctx.abort,
                  }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              }),
            )
            if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
            const result = exit.value
            const output = textOutput(result)
            return {
              title: `RLM execution (${subLLMCalls} sub-calls)`,
              metadata: metadata(),
              output: [
                output,
                "",
                "<rlm_metadata>",
                `sub_llm_calls: ${subLLMCalls}`,
                `execution_time_ms: ${Date.now() - start}`,
                `context_keys: ${rlmContext.keys().length}`,
                "</rlm_metadata>",
              ].join("\n"),
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log.error("rlm_repl execution failed", { error: message })
            return {
              title: "RLM execution failed",
              metadata: metadata(message),
              output: `Error: ${message}\n\nSub-LLM calls made before error: ${subLLMCalls}`,
            }
          }
        }),
    }
  }),
)
