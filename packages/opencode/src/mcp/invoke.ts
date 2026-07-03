import type { ToolExecutionOptions } from "ai"
import { Effect } from "effect"
import type { Plugin } from "@/plugin"
import type { Tool } from "@/tool/tool"

/**
 * The shared middle of every raw MCP tool invocation: plugin `tool.execute.before`
 * hook → permission ask → dispatch through the ai-sdk tool's execute inside the
 * `Tool.execute` tracing span → plugin `tool.execute.after` hook. Used by both the
 * legacy per-tool registration in `SessionTools.resolve` and code-mode child calls,
 * so MCP tools execute identically on either path.
 *
 * Returns the RAW result the ai-sdk execute resolved with — callers own their
 * shaping edge (model-facing text/attachment shaping + truncation on the legacy
 * path, `toSandboxResult` for code-mode child calls). The after hook fires here
 * with that same raw result, which is exactly what the legacy loop always passed
 * (the raw MCP result, not the shaped `{title, output, metadata}`), so the hook
 * payload cannot drift between callers.
 *
 * `callID` is the hook/span identity — an opaque string nothing parses. Legacy
 * passes the ai-sdk `toolCallId`; code-mode child calls pass a synthetic
 * `${parentCallID}/${n}`. `options.toolCallId` is what the ai-sdk execute sees and
 * stays each caller's existing value. Failure semantics belong to the caller: hook
 * failures, permission denials, and tool failures all propagate — the legacy path
 * lets them fail the tool call as before; code mode converts them into catchable
 * in-program tool errors at its edge.
 */
export const invoke = Effect.fn("McpInvoke.invoke")(function* <R>(input: {
  plugin: Plugin.Interface
  key: string
  execute: (args: any, options: ToolExecutionOptions) => R | PromiseLike<R>
  args: any
  callID: string
  options: ToolExecutionOptions
  sessionID: string
  messageID: string
  ask: Tool.Context["ask"]
}) {
  yield* input.plugin.trigger(
    "tool.execute.before",
    { tool: input.key, sessionID: input.sessionID, callID: input.callID },
    { args: input.args },
  )
  const result: R = yield* Effect.gen(function* () {
    yield* input.ask({ permission: input.key, metadata: {}, patterns: ["*"], always: ["*"] })
    return yield* Effect.promise(() => Promise.resolve(input.execute(input.args, input.options)))
  }).pipe(
    Effect.withSpan("Tool.execute", {
      attributes: {
        "tool.name": input.key,
        "tool.call_id": input.callID,
        "session.id": input.sessionID,
        "message.id": input.messageID,
      },
    }),
  )
  yield* input.plugin.trigger(
    "tool.execute.after",
    { tool: input.key, sessionID: input.sessionID, callID: input.callID, args: input.args },
    result,
  )
  return result
})

export * as McpInvoke from "./invoke"
