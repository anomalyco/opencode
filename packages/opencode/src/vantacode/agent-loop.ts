/**
 * VantaCode native agent loop.
 *
 * Drives a conversation with a local Ollama model over the native /api/chat
 * endpoint while enforcing the reliability guarantees the spec requires:
 *
 *   - Tool output is ONLY ever the real return value of a tool the loop ran.
 *   - If the model narrates an action without actually calling the tool, the
 *     claim is discarded and the turn is retried with a stricter instruction
 *     (hallucination guard).
 *   - Every intended tool call is validated against its JSON schema before it
 *     executes; malformed calls are rejected and retried.
 *   - A permission gate can require approval / block destructive commands.
 *   - Files touched are tracked for the end-of-session summary.
 *
 * The loop is transport-agnostic about the actual tool implementations: the
 * caller supplies a `ToolExecutor`. This keeps it unit-testable with fakes.
 */

import { OllamaClient, type OllamaMessage, type OllamaTool, type OllamaToolCall } from "./ollama.ts"
import {
  ExecutionLog,
  HallucinationStreak,
  HALLUCINATION_RETRY_INSTRUCTION,
  TOOL_REQUIRED_RETRY_INSTRUCTION,
  detectHallucination,
} from "./hallucination-guard.ts"
import { validateToolCall, validationRetryMessage, type ToolSchemaDef } from "./tool-validate.ts"

export interface ToolExecutionResult {
  readonly ok: boolean
  readonly output: string
  /** Absolute paths this tool created/modified, for the touched-files summary. */
  readonly filesTouched?: string[]
}

export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
}

export type PermissionDecision = "allow" | "deny"

export interface PermissionGate {
  /** Decide whether a validated tool call may run. */
  check(name: string, args: Record<string, unknown>): Promise<PermissionDecision> | PermissionDecision
}

export type LoopEvent =
  | { readonly type: "assistant-text"; readonly text: string; readonly streaming: boolean }
  | { readonly type: "tool-call"; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly type: "tool-result"; readonly name: string; readonly ok: boolean; readonly output: string }
  | { readonly type: "tool-rejected"; readonly name: string; readonly reason: string }
  | { readonly type: "permission-denied"; readonly name: string }
  | { readonly type: "hallucination"; readonly reason: string }
  | { readonly type: "warning"; readonly message: string }
  | { readonly type: "turn-start"; readonly turn: number }
  | { readonly type: "done"; readonly reason: "no-tool-calls" | "max-turns" }

export interface AgentLoopOptions {
  readonly client: OllamaClient
  readonly model: string
  readonly tools: ToolSchemaDef[]
  readonly executor: ToolExecutor
  readonly permission?: PermissionGate
  readonly systemPrompt?: string
  readonly stream?: boolean
  readonly maxTurns?: number
  /** Ollama request options (num_gpu, num_ctx, num_thread, temperature...). */
  readonly options?: Record<string, unknown>
  readonly onEvent?: (event: LoopEvent) => void
}

export interface LoopResult {
  readonly messages: OllamaMessage[]
  readonly filesTouched: string[]
  readonly executionLog: ExecutionLog
  readonly turns: number
  readonly stoppedReason: "no-tool-calls" | "max-turns"
  readonly hallucinationWarned: boolean
}

function toOllamaTools(tools: ToolSchemaDef[]): OllamaTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

interface TurnOutput {
  readonly text: string
  readonly toolCalls: OllamaToolCall[]
}

async function runSingleTurn(options: AgentLoopOptions, messages: OllamaMessage[]): Promise<TurnOutput> {
  const tools = toOllamaTools(options.tools)
  if (!options.stream) {
    const res = await options.client.chat({
      model: options.model,
      stream: false,
      messages,
      tools,
      options: options.options,
    })
    const text = res.message?.content ?? ""
    if (text) options.onEvent?.({ type: "assistant-text", text, streaming: false })
    return { text, toolCalls: res.message?.tool_calls ?? [] }
  }

  let text = ""
  const toolCalls: OllamaToolCall[] = []
  for await (const chunk of options.client.chatStream({
    model: options.model,
    stream: true,
    messages,
    tools,
    options: options.options,
  })) {
    const piece = chunk.message?.content ?? ""
    if (piece) {
      text += piece
      options.onEvent?.({ type: "assistant-text", text: piece, streaming: true })
    }
    if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls)
  }
  return { text, toolCalls }
}

export async function runAgentLoop(userInput: string, options: AgentLoopOptions): Promise<LoopResult> {
  const maxTurns = options.maxTurns ?? 12
  const executionLog = new ExecutionLog()
  const streak = new HallucinationStreak()
  const filesTouched = new Set<string>()

  const messages: OllamaMessage[] = []
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt })
  messages.push({ role: "user", content: userInput })

  let stoppedReason: "no-tool-calls" | "max-turns" = "max-turns"
  let hallucinationWarned = false
  let turn = 0

  while (turn < maxTurns) {
    turn++
    options.onEvent?.({ type: "turn-start", turn })
    executionLog.reset()

    let output = await runSingleTurn(options, messages)
    const madeToolCall = output.toolCalls.length > 0

    // No tool calls this turn: check for a bypass hallucination.
    if (!madeToolCall) {
      const verdict = detectHallucination(output.text, executionLog, false)
      streak.record(verdict.hallucinated)
      if (verdict.hallucinated) {
        // Discard the narrated claim and retry once with a stricter instruction.
        options.onEvent?.({ type: "hallucination", reason: verdict.reason ?? "narrated action without tool call" })
        messages.push({ role: "system", content: HALLUCINATION_RETRY_INSTRUCTION })
        output = await runSingleTurn(options, messages)
        if (output.toolCalls.length === 0) {
          // Still no tool call — surface unreliable-model warning if streak is high.
          if (streak.shouldWarn()) {
            hallucinationWarned = true
            options.onEvent?.({ type: "warning", message: streak.unreliableModelWarning })
          }
          messages.push({ role: "assistant", content: output.text })
          stoppedReason = "no-tool-calls"
          break
        }
        // fallthrough: process the tool calls the retry produced
      } else {
        messages.push({ role: "assistant", content: output.text })
        stoppedReason = "no-tool-calls"
        break
      }
    }

    // Record the assistant message (with its tool calls) before executing.
    messages.push({ role: "assistant", content: output.text, tool_calls: output.toolCalls })

    // Validate + gate + execute each tool call; feed back ONLY real results.
    for (const call of output.toolCalls) {
      const name = call.function.name
      const args = call.function.arguments ?? {}

      const validation = validateToolCall({ name, arguments: args }, options.tools)
      if (!validation.ok) {
        const reason = validationRetryMessage(validation)
        options.onEvent?.({ type: "tool-rejected", name, reason })
        messages.push({ role: "tool", tool_name: name, content: `TOOL CALL REJECTED: ${reason}` })
        continue
      }

      options.onEvent?.({ type: "tool-call", name, args })

      const decision = options.permission ? await options.permission.check(name, args) : "allow"
      if (decision === "deny") {
        options.onEvent?.({ type: "permission-denied", name })
        messages.push({ role: "tool", tool_name: name, content: "TOOL CALL DENIED by permission policy." })
        continue
      }

      const result = await options.executor.execute(name, args)
      executionLog.record({ tool: name, args, ok: result.ok, resultSummary: result.output.slice(0, 200) })
      for (const f of result.filesTouched ?? []) filesTouched.add(f)
      options.onEvent?.({ type: "tool-result", name, ok: result.ok, output: result.output })
      // The real tool return value is the ONLY source of tool output.
      messages.push({ role: "tool", tool_name: name, content: result.output })
    }
  }

  options.onEvent?.({ type: "done", reason: stoppedReason })
  return {
    messages,
    filesTouched: [...filesTouched],
    executionLog,
    turns: turn,
    stoppedReason,
    hallucinationWarned,
  }
}
