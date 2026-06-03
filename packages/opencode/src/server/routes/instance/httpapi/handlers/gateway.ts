import { Provider } from "@/provider/provider"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { streamText } from "ai"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { GatewayApi } from "../groups/gateway"
import * as OpenAIConvert from "../gateway/openai-convert"

const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
} as const

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function completionID() {
  return "chatcmpl-" + crypto.randomUUID().replace(/-/g, "")
}

function errorResponse(status: number, message: string, type: string, code: string | null) {
  return HttpServerResponse.jsonUnsafe(OpenAIConvert.errorBody(message, type, code), { status })
}

function streamResponse(
  fullStream: Parameters<typeof OpenAIConvert.toSseStream>[0],
  meta: OpenAIConvert.ChunkMeta,
) {
  return HttpServerResponse.stream(
    Stream.fromAsyncIterable(OpenAIConvert.toSseStream(fullStream, meta), (e) =>
      e instanceof Error ? e : new Error(String(e)),
    ).pipe(Stream.encodeText),
    { contentType: "text/event-stream", headers: SSE_HEADERS },
  )
}

export const gatewayHandlers = HttpApiBuilder.group(GatewayApi, "gateway", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service

    const models = Effect.fn("GatewayHttpApi.models")(function* () {
      const providers = yield* provider.list()
      const data = []
      for (const [providerID, info] of Object.entries(providers)) {
        for (const model of Object.values(info.models)) {
          data.push({ id: `${providerID}/${model.id}`, object: "model", created: 0, owned_by: providerID })
        }
      }
      return HttpServerResponse.jsonUnsafe({ object: "list", data })
    })

    const vscodeConfig = Effect.fn("GatewayHttpApi.vscodeConfig")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const providers = yield* provider.list()
      const host = ctx.request.headers.host ?? "localhost:4096"
      const url = `http://${host}/v1/chat/completions`
      const entries = []
      for (const [providerID, info] of Object.entries(providers)) {
        for (const model of Object.values(info.models)) {
          entries.push({
            id: `${providerID}/${model.id}`,
            name: `opencode: ${model.name}`,
            url,
            apiType: "chat-completions",
            toolCalling: model.capabilities.toolcall,
            vision: model.capabilities.input.image,
            maxInputTokens: model.limit.context,
            maxOutputTokens: model.limit.output,
          })
        }
      }
      return HttpServerResponse.jsonUnsafe(entries)
    })

    const chatCompletions = Effect.fn("GatewayHttpApi.chatCompletions")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const bodyText = yield* Effect.orDie(ctx.request.text)
      let req: OpenAIConvert.OpenAIChatRequest
      try {
        req = JSON.parse(bodyText || "{}")
      } catch {
        return errorResponse(400, "Invalid JSON request body", "invalid_request_error", null)
      }
      if (!req || typeof req.model !== "string" || !Array.isArray(req.messages)) {
        return errorResponse(400, "`model` and `messages` are required", "invalid_request_error", null)
      }

      const { providerID, modelID } = Provider.parseModel(req.model)
      const abort = ctx.request.source instanceof Request ? ctx.request.source.signal : undefined

      const program = Effect.gen(function* () {
        const model = yield* provider.getModel(providerID, modelID)
        const language = yield* provider.getLanguage(model)
        const converted = OpenAIConvert.convertRequest(req, model)
        const result = streamText({
          model: language,
          messages: converted.messages,
          tools: converted.tools,
          toolChoice: converted.toolChoice,
          temperature: converted.temperature,
          topP: converted.topP,
          maxOutputTokens: converted.maxOutputTokens,
          abortSignal: abort,
          maxRetries: 0,
        })
        const meta: OpenAIConvert.ChunkMeta = {
          id: completionID(),
          created: nowSeconds(),
          model: req.model,
          includeUsage: req.stream_options?.include_usage ?? false,
        }
        if (req.stream) return streamResponse(result.fullStream, meta)
        const completion = yield* Effect.tryPromise(() => OpenAIConvert.aggregate(result.fullStream, meta))
        return HttpServerResponse.jsonUnsafe(completion)
      })

      return yield* program.pipe(
        Effect.catchTag("ProviderModelNotFoundError", (error) =>
          Effect.succeed(
            errorResponse(
              404,
              `The model \`${req.model}\` does not exist` +
                (error.suggestions?.length ? ` (did you mean: ${error.suggestions.join(", ")})` : ""),
              "invalid_request_error",
              "model_not_found",
            ),
          ),
        ),
        Effect.catch((error) =>
          Effect.succeed(errorResponse(502, OpenAIConvert.openAIError(error).message, "api_error", null)),
        ),
        Effect.catchDefect((defect) =>
          Effect.succeed(errorResponse(500, OpenAIConvert.openAIError(defect).message, "api_error", null)),
        ),
      )
    })

    return handlers
      .handleRaw("models", models)
      .handleRaw("chatCompletions", chatCompletions)
      .handleRaw("vscodeConfig", vscodeConfig)
  }),
)
