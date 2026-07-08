import { Effect, Schema, Stream } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { OpenAIChatEvent, DEFAULT_BASE_URL, PATH } from "@opencode-ai/llm/protocols/openai-chat"
import { SimulationLLMExchange } from "./llm-exchange"
import { SimulationNetwork } from "./network"

/**
 * Driver-answered OpenAI endpoint for the simulated network.
 *
 * Claims `POST {DEFAULT_BASE_URL}{PATH}` (the real openai-chat route
 * endpoint), opens an LLM exchange, and streams the driver's chunks back as
 * an OpenAI Chat SSE response terminated by `[DONE]`. Everything downstream
 * of the response bytes is the real pipeline: SSE framing, the OpenAIChat
 * event schema, the protocol state machine, and Lifecycle grammar.
 */

const encodeChunk = Schema.encodeUnknownSync(OpenAIChatEvent)

const encoder = new TextEncoder()

// The simulated model id is echoed back only in non-schema fields; the
// protocol event schema ignores unknown fields, so id/object/model are
// decorative wire realism.
function chunkOf(item: SimulationLLMExchange.Item): OpenAIChatEvent | unknown {
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

const finishReasonWire: Record<SimulationLLMExchange.FinishReason, string> = {
  stop: "stop",
  "tool-calls": "tool_calls",
  length: "length",
  "content-filter": "content_filter",
}

function frame(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function sseBody(exchange: SimulationLLMExchange.Exchange): Stream.Stream<Uint8Array> {
  const chunks = Stream.fromQueue(exchange.queue).pipe(
    Stream.takeUntil((chunk) => chunk.type === "finish"),
    Stream.map((chunk) => {
      if (chunk.type === "finish")
        return frame(encodeChunk({ choices: [{ delta: {}, finish_reason: finishReasonWire[chunk.reason] }] }))
      if (chunk.item.type === "raw") return frame(chunk.item.chunk)
      return frame(encodeChunk(chunkOf(chunk.item)))
    }),
  )
  return chunks.pipe(
    Stream.concat(Stream.make(encoder.encode("data: [DONE]\n\n"))),
    // Close the exchange when the response body ends or is interrupted, so
    // late driver pushes fail with ExchangeNotFoundError instead of leaking.
    Stream.ensuring(SimulationLLMExchange.close(exchange.id)),
  )
}

export const route: SimulationNetwork.Route = {
  match: (request, url) => {
    if (request.method !== "POST") return undefined
    if (url.origin + url.pathname !== DEFAULT_BASE_URL + PATH) return undefined
    return Effect.gen(function* () {
      const body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : {}
      const exchange = yield* SimulationLLMExchange.open({ url: url.toString(), body })
      return HttpClientResponse.fromWeb(
        request,
        new Response(Stream.toReadableStream(sseBody(exchange)), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
  },
}

export * as SimulationOpenAI from "./openai"
