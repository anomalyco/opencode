import { createAnthropic } from "@ai-sdk/anthropic"
import type { Tool } from "ai"
import type { Provider } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

export const executor = "claude-sonnet-4-6"
export const model = "claude-opus-4-6"
export const callID = "srvtoolu_advisor_fixture"
export const advice = { type: "advisor_result", text: "Use bounded concurrency." } as const
export const encrypted = { type: "advisor_redacted_result", encryptedContent: "opaque-fixture" } as const
export const unavailable = { type: "advisor_tool_result_error", errorCode: "overloaded" } as const

export const catalogModel: Provider.Model = {
  id: ModelV2.ID.make(executor),
  providerID: ProviderV2.ID.make("anthropic"),
  name: "Fixture executor",
  api: { id: executor, npm: "@ai-sdk/anthropic", url: "https://api.anthropic.com/v1" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    interleaved: false,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
  },
  cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  limit: { context: 200000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}
export const catalogAdvisor: Provider.Model = {
  ...catalogModel,
  id: ModelV2.ID.make(model),
  api: { ...catalogModel.api, id: model },
  cost: { input: 5, output: 25, cache: { read: 0.5, write: 6.25 } },
}

type Result = typeof advice | typeof encrypted | typeof unavailable
type Block =
  | { type: "text"; text: string }
  | { type: "server_tool_use" | "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "advisor_tool_result"; tool_use_id: string; content: Record<string, unknown> }

export const call: Block = { type: "server_tool_use", id: callID, name: "advisor", input: {} }
export const read: Block = { type: "tool_use", id: "toolu_read_fixture", name: "read", input: { filePath: "pool.ts" } }

export function result(value: Result): Block {
  const content =
    value.type === "advisor_redacted_result"
      ? { type: value.type, encrypted_content: value.encryptedContent }
      : value.type === "advisor_tool_result_error"
        ? { type: value.type, error_code: value.errorCode }
        : value
  return { type: "advisor_tool_result", tool_use_id: callID, content }
}

export const usage = {
  input_tokens: 20,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  iterations: [
    { type: "message", input_tokens: 20, output_tokens: 5 },
    { type: "advisor_message", model, input_tokens: 1000, output_tokens: 200 },
  ],
}

export function response(
  blocks: Block[],
  stop: "end_turn" | "pause_turn" | "tool_use" = "end_turn",
  reportedUsage = usage,
) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_advisor_fixture",
        type: "message",
        role: "assistant",
        model: executor,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    },
    ...blocks.flatMap((block, index) => [
      {
        type: "content_block_start",
        index,
        content_block:
          block.type === "text"
            ? { type: "text", text: "" }
            : block.type === "tool_use"
              ? { ...block, input: {} }
              : block,
      },
      ...(block.type === "text"
        ? [{ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }]
        : []),
      ...(block.type === "tool_use"
        ? [
            {
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
            },
          ]
        : []),
      { type: "content_block_stop", index },
    ]),
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: reportedUsage },
    { type: "message_stop" },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
}

export function provider(responses: string[]) {
  const requests: { body: string; headers: Headers }[] = []
  const client = createAnthropic({
    apiKey: "offline-advisor-fixture",
    fetch: Object.assign(
      async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const body = responses[requests.length]
        if (body === undefined) throw new Error("Unexpected advisor fixture request")
        requests.push({ body: String(init?.body), headers: new Headers(init?.headers) })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      },
      { preconnect: () => {} },
    ),
  })
  // The pinned SDKs use different provider-utils schema types; these fixtures verify the wire contract.
  const advisor = client.tools.advisor_20260301({ model, maxUses: 3 }) as Tool
  return { client, requests, advisor }
}

export async function collect<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader()
  const values: T[] = []
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) return values
      values.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
}
