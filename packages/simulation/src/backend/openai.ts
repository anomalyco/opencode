import { Effect, Schema, Stream } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError"
import { OpenAIChatEvent, DEFAULT_BASE_URL, PATH } from "@opencode-ai/llm/protocols/openai-chat"
import { SimulationNetwork } from "./network"
import { SimulatedProvider } from "./simulated-provider"

/**
 * Driver-answered OpenAI endpoint for the simulated network.
 *
 * Claims `POST {DEFAULT_BASE_URL}{PATH}` (the real openai-chat route
 * endpoint), invokes the simulated provider, and streams the driver's events back as
 * an OpenAI Chat SSE response terminated by `[DONE]`. Everything downstream
 * of the response bytes is the real pipeline: SSE framing, the OpenAIChat
 * event schema, the protocol state machine, and Lifecycle grammar.
 */

const encodeChunk = Schema.encodeUnknownSync(OpenAIChatEvent)

const encoder = new TextEncoder()
const decodeBody = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

// The simulated model id is echoed back only in non-schema fields; the
// protocol event schema ignores unknown fields, so id/object/model are
// decorative wire realism.
type ProviderItem = Exclude<SimulatedProvider.ProviderResponseEvent, { readonly type: "finish" }>
type FinishReason = Extract<SimulatedProvider.ProviderResponseEvent, { readonly type: "finish" }>["reason"]

function chunkOf(item: ProviderItem): OpenAIChatEvent | unknown {
  if (item.type === "textDelta") return { choices: [{ delta: { content: item.text } }] }
  if (item.type === "reasoningDelta") return { choices: [{ delta: { reasoning_content: item.text } }] }
  if (item.type === "toolCall")
    return {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: item.index,
                id: item.id,
                function: { name: item.name, arguments: JSON.stringify(item.input) },
              },
            ],
          },
        },
      ],
    }
  return item.chunk
}

const finishReasonWire: Record<FinishReason, string> = {
  stop: "stop",
  "tool-calls": "tool_calls",
  length: "length",
  "content-filter": "content_filter",
}

function frame(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function sseBody(
  events: Stream.Stream<SimulatedProvider.ProviderResponseEvent, SimulatedProvider.ProviderDisconnectedError>,
): Stream.Stream<Uint8Array, SimulatedProvider.ProviderDisconnectedError> {
  return events.pipe(
    Stream.map((event) => {
      if (event.type === "finish")
        return frame(encodeChunk({ choices: [{ delta: {}, finish_reason: finishReasonWire[event.reason] }] }))
      if (event.type === "raw") return frame(event.chunk)
      return frame(encodeChunk(chunkOf(event)))
    }),
    Stream.concat(Stream.make(encoder.encode("data: [DONE]\n\n"))),
  )
}

export const route = (provider: SimulatedProvider.Interface): SimulationNetwork.Route => ({
  match: (request, url) => {
    if (request.method !== "POST") return undefined
    if (url.origin + url.pathname !== DEFAULT_BASE_URL + PATH) return undefined
    return Effect.gen(function* () {
      const body =
        request.body._tag === "Uint8Array"
          ? yield* decodeBody(new TextDecoder().decode(request.body.body)).pipe(
              Effect.mapError(
                (cause) =>
                  new HttpClientError({
                    reason: new TransportError({
                      request,
                      cause,
                      description: "Simulation received an invalid OpenAI request body",
                    }),
                  }),
              ),
            )
          : {}
      return HttpClientResponse.fromWeb(
        request,
        new Response(Stream.toReadableStream(sseBody(provider.stream({ url: url.toString(), body }))), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
  },
})

export * as SimulationOpenAI from "./openai"
