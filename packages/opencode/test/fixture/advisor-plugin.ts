import type { Plugin } from "@opencode-ai/plugin"
import { Schema } from "effect"
import { appendFile } from "node:fs/promises"
import { advice, call, callID, encrypted, read, response, result, unavailable, usage } from "./advisor"

// Scenarios (OPENCODE_ADVISOR_FIXTURE_SCENARIO):
// - complete (default): one response with server_tool_use + plaintext advisor result + local read tool call
// - pause: server_tool_use with pause_turn, then result + read on resumption
// - encrypted: like complete, but the advisor result is redacted (encrypted_content)
// - error: like complete, but the advisor result is an advisor_tool_result_error
// - cancel: streams the server_tool_use and then stalls until the request is aborted
const SCENARIOS = ["complete", "pause", "encrypted", "error", "cancel"] as const
type Scenario = (typeof SCENARIOS)[number]

function scenario(): Scenario {
  const value = process.env.OPENCODE_ADVISOR_FIXTURE_SCENARIO ?? "complete"
  if (!SCENARIOS.includes(value as Scenario)) throw new Error(`Unknown advisor fixture scenario: ${value}`)
  return value as Scenario
}

function stalled(prefix: string, signal?: AbortSignal | null) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(prefix))
      const abort = () => {
        try {
          controller.close()
        } catch {}
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener("abort", abort, { once: true })
    },
  })
}

const Block = Schema.Struct({
  type: Schema.String,
  name: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  tool_use_id: Schema.optional(Schema.String),
})
const RequestBody = Schema.Struct({
  model: Schema.String,
  tools: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.optional(Schema.String) }))),
  messages: Schema.Array(
    Schema.Struct({ role: Schema.String, content: Schema.Union([Schema.String, Schema.Array(Block)]) }),
  ),
})

export const AdvisorFixturePlugin: Plugin = async () => ({
  auth: {
    provider: "anthropic",
    methods: [],
    loader: async () => ({
      apiKey: "offline-advisor-fixture",
      fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.origin !== "https://api.anthropic.com" || url.pathname !== "/v1/messages") {
          throw new Error("Unexpected advisor fixture URL")
        }
        const body = Schema.decodeUnknownSync(RequestBody)(JSON.parse(String(init?.body)))
        const blocks = body.messages.flatMap((message) => (typeof message.content === "string" ? [] : message.content))
        const advertised = body.tools?.some((tool) => tool.type === "advisor_20260301") ?? false
        const completed = blocks.some((block) => block.type === "advisor_tool_result" && block.tool_use_id === callID)
        const pending = blocks.some((block) => block.type === "server_tool_use" && block.id === callID) && !completed
        if (pending && !advertised) throw new Error("Pending advisor request lost its tool definition")
        const plainUsage = { ...usage, iterations: usage.iterations.filter((entry) => entry.type === "message") }
        const mode = scenario()
        const phase = pending
          ? "resume"
          : advertised && !completed
            ? mode === "pause"
              ? "pause"
              : mode === "cancel"
                ? "cancel"
                : "consult"
            : "finish"
        const outcome = mode === "encrypted" ? encrypted : mode === "error" ? unavailable : advice
        const log = process.env.OPENCODE_ADVISOR_FIXTURE_LOG
        if (log)
          await appendFile(
            log,
            JSON.stringify({
              phase,
              advertised,
              completed,
              pending,
              model: body.model,
              beta: new Headers(init?.headers).get("anthropic-beta"),
            }) + "\n",
          )
        const headers = { "content-type": "text/event-stream" }
        if (phase === "cancel") {
          // Emit everything up to (and including) the advisor call, then hold the stream open until aborted.
          const full = response([call], "pause_turn", plainUsage)
          const prefix = full.slice(0, full.indexOf("event: message_delta"))
          return new Response(stalled(prefix, init?.signal), { headers })
        }
        const wire =
          phase === "pause"
            ? response([call], "pause_turn", plainUsage)
            : phase === "consult"
              ? response([call, result(outcome), read], "tool_use")
              : phase === "resume"
                ? response([result(outcome), read], "tool_use")
                : response([{ type: "text", text: "Fixture complete." }], "end_turn", plainUsage)
        return new Response(wire, { headers })
      },
    }),
  },
})
