import { Effect, Exit } from "effect"
import * as Tool from "./tool"
import fs from "node:fs/promises"

export interface TraceEntry {
  timestamp: string
  session_id: string
  task_id: string
  tool_id: string
  input_chars: number
  output_chars: number
  success: boolean
  retry: boolean
  wall_time_ms: number
}

const TRACE_FILE = process.env["OPENCODE_TOOL_TRACE_FILE"] ?? "tool_trace.jsonl"

export function withTrace(sessionId: string, tool: Tool.Def): Tool.Def {
  return {
    ...tool,
    execute: (args, ctx) =>
      Effect.gen(function* () {
        const start = performance.now()
        const inputChars = JSON.stringify(args).length
        const exit = yield* tool.execute(args, ctx).pipe(Effect.exit)
        const wallTime = performance.now() - start
        const success = Exit.isSuccess(exit)
        const outputChars = success ? exit.value.output.length : 0
        const entry: TraceEntry = {
          timestamp: new Date().toISOString(),
          session_id: sessionId,
          task_id: process.env["OPENCODE_BENCHMARK_TASK"] ?? "",
          tool_id: tool.id,
          input_chars: inputChars,
          output_chars: outputChars,
          success,
          retry: false,
          wall_time_ms: Math.round(wallTime),
        }
        yield* Effect.promise(() => fs.appendFile(TRACE_FILE, JSON.stringify(entry) + "\n"))
        if (success) return exit.value
        return yield* Effect.failCause(exit.cause)
      }),
  }
}
