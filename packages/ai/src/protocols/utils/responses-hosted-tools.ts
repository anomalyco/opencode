import { Effect } from "effect"
import { LLMEvent, type AIError, type ToolResultPart } from "../../schema/index.js"
import { OpenResponses } from "../open-responses.js"
import { Lifecycle } from "./lifecycle.js"

export type Item = OpenResponses.OutputItem & {
  readonly status?: string
  readonly action?: unknown
  readonly queries?: unknown
  readonly results?: unknown
  readonly code?: string
  readonly container_id?: string
  readonly outputs?: unknown
  readonly server_label?: string
  readonly output?: unknown
  readonly result?: string
  readonly output_format?: "png" | "jpeg" | "webp"
  readonly error?: unknown
}

export interface Definition {
  readonly name: string
  readonly input: (item: Item) => unknown
  readonly result?: (item: Item) => Effect.Effect<ToolResultPart["result"], AIError>
}

export type Definitions = Readonly<Record<string, Definition>>

export const isItem = <Tools extends Definitions>(item: OpenResponses.OutputItem, tools: Tools): item is Item =>
  item.type in tools

export const onDone: (
  state: OpenResponses.ParserState,
  item: Item,
  tools: Definitions,
) => Effect.Effect<OpenResponses.StepResult, AIError> = Effect.fn("ResponsesHostedTools.onDone")(
  function* (state, item, tools) {
    const tool = tools[item.type]
    if (!tool) return [state, []] satisfies OpenResponses.StepResult
    const providerMetadata = OpenResponses.providerMetadata(state, { itemId: item.id })
    const events: LLMEvent[] = []
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events)
    events.push(
      LLMEvent.toolCall({
        id: item.id,
        name: tool.name,
        input: tool.input(item),
        providerExecuted: true,
        providerMetadata,
      }),
      LLMEvent.toolResult({
        id: item.id,
        name: tool.name,
        result: tool.result
          ? yield* tool.result(item)
          : item.error !== undefined && item.error !== null
            ? { type: "error", value: item.error }
            : { type: "json", value: item },
        providerExecuted: true,
        providerMetadata,
      }),
    )
    return [{ ...state, lifecycle }, events] satisfies OpenResponses.StepResult
  },
)

export * as ResponsesHostedTools from "./responses-hosted-tools.js"
