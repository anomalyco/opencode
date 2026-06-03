import { Effect } from "effect"
import { LLMEvent, type ToolCallPart, ToolFailure, ToolResultValue, type ToolResultValue as ToolResultValueType } from "./schema"
import { type AnyTool, type Tools } from "./tool"

export interface DispatchResult {
  readonly result: ToolResultValueType
  readonly events: ReadonlyArray<LLMEvent>
}

/** Execute one canonical tool call without owning provider IO or continuation. */
export const dispatch = (tools: Tools, call: ToolCallPart): Effect.Effect<DispatchResult> => {
  const tool = tools[call.name]
  if (!tool) return Effect.succeed(result(call, { type: "error", value: `Unknown tool: ${call.name}` }))
  if (!tool.execute)
    return Effect.succeed(result(call, { type: "error", value: `Tool has no execute handler: ${call.name}` }))

  return decodeAndExecute(tool, call).pipe(
    Effect.map((value) => result(call, value)),
    Effect.catchTag("LLM.ToolFailure", (failure) =>
      Effect.succeed(result(call, { type: "error", value: failure.message }, failure.error)),
    ),
  )
}

const decodeAndExecute = (tool: AnyTool, call: ToolCallPart): Effect.Effect<ToolResultValueType, ToolFailure> =>
  tool._decode(call.input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) => tool.execute!(decoded, { id: call.id, name: call.name })),
    Effect.flatMap((value) =>
      tool._encode(value).pipe(
        Effect.mapError(
          (error) =>
            new ToolFailure({
              message: `Tool returned an invalid value for its success schema: ${error.message}`,
            }),
        ),
      ),
    ),
    Effect.map(
      (encoded): ToolResultValueType => (ToolResultValue.is(encoded) ? encoded : { type: "json", value: encoded }),
    ),
  )

const result = (call: ToolCallPart, value: ToolResultValueType, error?: unknown): DispatchResult => ({
  result: value,
  events:
    value.type === "error"
      ? [
          LLMEvent.toolError({ id: call.id, name: call.name, message: String(value.value), error }),
          LLMEvent.toolResult({ id: call.id, name: call.name, result: value }),
        ]
      : [LLMEvent.toolResult({ id: call.id, name: call.name, result: value })],
})

export const ToolRuntime = { dispatch } as const
