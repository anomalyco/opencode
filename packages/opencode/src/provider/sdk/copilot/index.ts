import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible"
import type { LanguageModelV2, LanguageModelV2StreamPart, SharedV2ProviderMetadata } from "@ai-sdk/provider"
import { type FetchFunction, withoutTrailingSlash, withUserAgentSuffix } from "@ai-sdk/provider-utils"
import { OpenAIResponsesLanguageModel } from "../openai-compatible/src/responses/openai-responses-language-model"

type RawChunk = {
  choices?: Array<{
    message?: { reasoning_opaque?: string }
    delta?: { reasoning_opaque?: string }
  }>
}

const extractor = {
  async extractMetadata({ parsedBody }: { parsedBody: unknown }): Promise<SharedV2ProviderMetadata | undefined> {
    const body = parsedBody as RawChunk
    const opaque = body?.choices?.[0]?.message?.reasoning_opaque
    if (!opaque) return undefined
    return { openaiCompatible: { reasoning_opaque: opaque } }
  },
  createStreamExtractor: () => ({ processChunk() {}, buildMetadata: () => undefined }),
}

function wrapStream(stream: ReadableStream<LanguageModelV2StreamPart>) {
  const state = { opaque: undefined as string | undefined }
  return stream.pipeThrough(
    new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
      transform(chunk, controller) {
        if (chunk.type === "raw") {
          const raw = chunk.rawValue as RawChunk
          state.opaque ??= raw?.choices?.[0]?.delta?.reasoning_opaque
        }
        if (chunk.type === "reasoning-end" && state.opaque) {
          controller.enqueue({
            ...chunk,
            providerMetadata: { ...chunk.providerMetadata, openaiCompatible: { reasoning_opaque: state.opaque } },
          })
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

function createFetchAdapter(base?: FetchFunction): FetchFunction {
  const fetcher = base ?? globalThis.fetch
  return (async (url, init) => {
    const response = await fetcher(url, init)
    if (!url.toString().includes("/chat/completions")) return response

    const contentType = response.headers.get("content-type") ?? ""

    if (contentType.includes("text/event-stream")) {
      return new Response(
        response.body!.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk)
              controller.enqueue(new TextEncoder().encode(text.replace(/"reasoning_text":/g, '"reasoning_content":')))
            },
          }),
        ),
        { status: response.status, headers: response.headers },
      )
    }

    const text = await response.text()
    return new Response(text.replace(/"reasoning_text":/g, '"reasoning_content":'), {
      status: response.status,
      headers: response.headers,
    })
  }) as FetchFunction
}

export function createCopilot(
  options: {
    apiKey?: string
    baseURL?: string
    name?: string
    headers?: Record<string, string>
    fetch?: FetchFunction
  } = {},
) {
  const baseURL = withoutTrailingSlash(options.baseURL ?? "https://api.openai.com/v1")
  const headers = {
    ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    ...options.headers,
  }
  const getHeaders = () => withUserAgentSuffix(headers, "opencode/copilot")
  const copilotFetch = createFetchAdapter(options.fetch)

  const createChatModel = (id: string): LanguageModelV2 => {
    const model = new OpenAICompatibleChatLanguageModel(id, {
      provider: "openai.chat",
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: copilotFetch,
      metadataExtractor: extractor,
    })

    return {
      specificationVersion: model.specificationVersion,
      modelId: model.modelId,
      provider: model.provider,
      get supportedUrls() {
        return model.supportedUrls
      },
      doGenerate: model.doGenerate.bind(model),
      async doStream(opts) {
        const result = await model.doStream({ ...opts, includeRawChunks: true })
        return { ...result, stream: wrapStream(result.stream) }
      },
    }
  }

  const createResponsesModel = (id: string): LanguageModelV2 => {
    return new OpenAIResponsesLanguageModel(id, {
      provider: `${options.name ?? "copilot"}.responses`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: options.fetch,
    })
  }

  return Object.assign((id: string) => createChatModel(id), {
    languageModel: createChatModel,
    chat: createChatModel,
    responses: createResponsesModel,
  })
}
