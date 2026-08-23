import { Effect } from "effect"
import {
  LLMEvent,
  type ToolCallPart,
  ToolFailure,
  ToolOutput,
  ToolResultValue,
  type ToolOutput as ToolOutputType,
  type ToolResultValue as ToolResultValueType,
} from "./schema/index.js"
import { type AnyTool, type Tools } from "./tool.js"

export interface ToolSettlement {
  readonly result: ToolResultValueType
  readonly output?: ToolOutputType
}

export interface DispatchResult extends ToolSettlement {
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
    Effect.catchTag("Tool.Error", (failure) =>
      Effect.succeed(result(call, { type: "error", value: failure.message }, failure.error)),
    ),
  )
}

type Revived = { readonly value: unknown; readonly changed: boolean }

// Some gateways serialize null as the literal string "null" inside tool
// arguments. Revive those tokens before decoding: nullable fields then receive
// real nulls, while schemas that reject the revived form fall back to the raw
// payload - so a string field whose legitimate content is "null" still works.
const reviveNullStrings = (value: unknown): Revived => {
  if (value === "null") return { value: null, changed: true }
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const revived = reviveNullStrings(item)
      changed = changed || revived.changed
      return revived.value
    })
    return { value: items, changed }
  }
  if (value !== null && typeof value === "object") {
    let changed = false
    const entries = Object.entries(value).map(([key, item]) => {
      const revived = reviveNullStrings(item)
      changed = changed || revived.changed
      return [key, revived.value]
    })
    return { value: Object.fromEntries(entries), changed }
  }
  return { value, changed: false }
}

const decodeToolInput = (tool: AnyTool, input: ToolCallPart["input"]) => {
  const salvaged = reviveNullStrings(input)
  if (!salvaged.changed) return tool._decode(input)
  // Gateways that serialize null as the string "null" hit every nullable field,
  // so try the revived form first; fall back to the raw payload when the schema
  // rejects it (e.g. a string field whose legitimate content is "null").
  return tool._decode(salvaged.value).pipe(Effect.catch(() => tool._decode(input)))
}

const decodeAndExecute = (tool: AnyTool, call: ToolCallPart): Effect.Effect<ToolSettlement, ToolFailure> =>
  decodeToolInput(tool, call.input).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
    Effect.flatMap((decoded) =>
      tool.execute!(decoded, { id: call.id, name: call.name }).pipe(
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
        Effect.map((encoded) => {
          if (tool._legacyResult && ToolResultValue.is(encoded))
            return { result: encoded, output: ToolOutput.fromResultValue(encoded) }
          const output = tool._project(decoded, call.id, encoded)
          const result = ToolOutput.toResultValue(output)
          return result.type === "error" ? { result } : { result, output }
        }),
      ),
    ),
  )

const result = (call: ToolCallPart, value: ToolResultValueType | ToolSettlement, error?: unknown): DispatchResult => {
  const settlement = ToolResultValue.is(value) ? { result: value } : value
  return {
    result: settlement.result,
    output: settlement.output,
    events:
      settlement.result.type === "error"
        ? [
            LLMEvent.toolError({
              id: call.id,
              name: call.name,
              message: String(settlement.result.value),
              error,
              providerMetadata: call.providerMetadata,
            }),
            LLMEvent.toolResult({
              id: call.id,
              name: call.name,
              result: settlement.result,
              providerMetadata: call.providerMetadata,
            }),
          ]
        : [
            LLMEvent.toolResult({
              id: call.id,
              name: call.name,
              result: settlement.result,
              output: settlement.output,
              providerMetadata: call.providerMetadata,
            }),
          ],
  }
}

export const ToolRuntime = { dispatch } as const
