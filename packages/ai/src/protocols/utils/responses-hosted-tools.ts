import { Effect } from "effect"
import { LLMEvent, type AIError, type LLMRequest, type ToolResultPart } from "../../schema/index.js"
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

/** Hosted tools that several Responses providers report with the same item shape. */
export const common = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  file_search_call: { name: "file_search", input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: "code_interpreter",
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  mcp_call: {
    name: "mcp",
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
} as const satisfies Definitions

export const isItem = <Tools extends Definitions>(item: OpenResponses.OutputItem, tools: Tools): item is Item =>
  item.type in tools

/**
 * Responses stream that turns completed hosted tool items into a provider-executed
 * tool call and result. `override` sees each normalized event first and may handle it.
 */
export const stream = (
  adapter: OpenResponses.ProviderAdapter,
  tools: Definitions,
  override?: (
    state: OpenResponses.ParserState,
    event: OpenResponses.NormalizedEvent,
  ) => Effect.Effect<OpenResponses.StepResult, AIError> | undefined,
) => ({
  event: OpenResponses.protocol.stream.event,
  initial: (request: LLMRequest) => OpenResponses.initial(request, adapter),
  step: (state: OpenResponses.ParserState, input: OpenResponses.Event) => {
    const event = OpenResponses.normalize(state, input)
    const handled = override?.(state, event)
    if (handled) return handled
    if (event.type === "response.output_item.done" && event.item && isItem(event.item, tools))
      return onDone(state, event.item, tools)
    return OpenResponses.step(state, event)
  },
  terminal: OpenResponses.terminal,
})

export const onDone: (
  state: OpenResponses.ParserState,
  item: Item,
  tools: Definitions,
) => Effect.Effect<OpenResponses.StepResult, AIError> = Effect.fnUntraced(
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
