import { Effect } from "effect"
import { Protocol } from "../route/protocol.js"
import { OpenResponses } from "./open-responses.js"
import { ProviderShared } from "./shared.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"

const ADAPTER = "xai-responses"
const NAME = "xAI Responses"

const extension = {
  id: ADAPTER,
  name: NAME,
} satisfies OpenResponses.Extension

const HOSTED_TOOLS = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  x_search_call: { name: "x_search", input: (item) => item.action ?? {} },
  file_search_call: { name: "file_search", input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: "code_interpreter",
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  image_generation_call: { name: "image_generation", input: () => ({}) },
  mcp_call: {
    name: "mcp",
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
} as const satisfies ResponsesHostedTools.Definitions

const step = (state: OpenResponses.ParserState, event: OpenResponses.Event) => {
  if (event.type === "response.reasoning_text.delta" || event.type === "response.reasoning_summary.delta")
    return event.item_id
      ? Effect.succeed(OpenResponses.onReasoningDelta(state, event, event.item_id))
      : ProviderShared.eventError(ADAPTER, `${event.type} is missing item_id`)
  if (event.type === "response.reasoning_text.done" || event.type === "response.reasoning_summary.done")
    return event.item_id
      ? Effect.succeed(OpenResponses.onReasoningDone(state, event))
      : ProviderShared.eventError(ADAPTER, `${event.type} is missing item_id`)
  if (event.type === "response.output_item.done" && event.item && ResponsesHostedTools.isItem(event.item, HOSTED_TOOLS))
    return ResponsesHostedTools.onDone(state, event.item, HOSTED_TOOLS)
  return OpenResponses.step(state, event)
}

export const protocol = Protocol.make({
  id: ADAPTER,
  body: OpenResponses.protocol.body,
  stream: {
    event: OpenResponses.protocol.stream.event,
    initial: (request) => OpenResponses.initial(request, extension),
    step,
    terminal: OpenResponses.terminal,
  },
})

export * as XAIResponses from "./xai-responses.js"
