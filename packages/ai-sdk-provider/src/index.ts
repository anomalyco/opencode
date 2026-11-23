import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createXai } from "@ai-sdk/xai"
import {
  type EmbeddingModelV4,
  type ImageModelV4,
  type LanguageModelV4,
  type LanguageModelV4StreamPart,
  type ProviderV4,
  type SharedV4ProviderMetadata,
} from "@ai-sdk/provider"
import { loadApiKey, withoutTrailingSlash, type FetchFunction } from "@ai-sdk/provider-utils"
import { z } from "zod"
import { imageModels, models } from "./models.js"

/** A model OpenCode serves, `opencode-go/<model>` for Go, or `<connection key>/<model>` for a workspace connection. */
export type OpenCodeModelId = keyof typeof models | (string & {})

/** An image model OpenCode serves. */
export type OpenCodeImageModelId = keyof typeof imageModels | (string & {})

/** The API a language model is called through. */
export type OpenCodeProtocol = "messages" | "responses" | "chat" | "google"

/** The images API an image model is called through. */
export type OpenCodeImageAPI = "openai" | "google" | "xai"

export interface OpenCodeProviderSettings {
  /** Defaults to the `OPENCODE_API_KEY` environment variable, read when a request is sent. */
  apiKey?: string
  /** Defaults to `https://opencode.ai/inference`. */
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface OpenCodeProvider extends ProviderV4 {
  (modelId: OpenCodeModelId): LanguageModelV4
  /** Calls the model through its native API: from the built-in model list, else guessed from its name. */
  languageModel(modelId: OpenCodeModelId): LanguageModelV4
  /** Anthropic Messages, through `@ai-sdk/anthropic`. */
  messages(modelId: OpenCodeModelId): LanguageModelV4
  /** OpenAI Responses, through `@ai-sdk/openai`. */
  responses(modelId: OpenCodeModelId): LanguageModelV4
  /** OpenAI Chat Completions, through `@ai-sdk/openai-compatible`. */
  chat(modelId: OpenCodeModelId): LanguageModelV4
  /** Gemini `generateContent`, through `@ai-sdk/google`. */
  google(modelId: OpenCodeModelId): LanguageModelV4
  embeddingModel(modelId: string): EmbeddingModelV4
  /** @deprecated Use `embeddingModel`. */
  textEmbeddingModel(modelId: string): EmbeddingModelV4
  /** Calls the model through its images API: OpenAI Images, Gemini `generateContent` or xAI Images. */
  imageModel(modelId: OpenCodeImageModelId): ImageModelV4
}

/** What OpenCode charged for a request, at `providerMetadata.opencode.usage`. */
export interface OpenCodeUsage {
  /** USD charged to the balance or the next invoice; 0 when free or on Go allowance. Absent for an unpriced model. */
  cost?: number
  /** USD at the model's list price. */
  listCost: number
  /** Who paid: `free`, `balance`, `go`, `go-plus` or `byok`. */
  billingSource: string
  /** `cost` is an estimate of what the provider charges a workspace connection (BYOK), not money OpenCode charged. */
  estimated?: boolean
  /** Go allowance used, in USD. */
  allowance?: number
  /** The tokens billed. `input` excludes cache reads and writes; `output` includes `reasoning`. */
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite5m: number
    cacheWrite1h: number
  }
}

export function createOpenCode(settings: OpenCodeProviderSettings = {}): OpenCodeProvider {
  const baseURL = withoutTrailingSlash(settings.baseURL) ?? "https://opencode.ai/inference"
  const apiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: "OPENCODE_API_KEY", description: "OpenCode" })
  const shared = { headers: settings.headers, fetch: settings.fetch }
  const anthropic = createAnthropic({ ...shared, baseURL: `${baseURL}/anthropic/v1`, authToken: apiKey })
  const openai = createOpenAI({ ...shared, baseURL: `${baseURL}/openai/v1`, apiKey })
  const compatible = createOpenAICompatible({
    ...shared,
    name: "opencode",
    baseURL: `${baseURL}/openai/v1`,
    apiKey,
    includeUsage: true,
  })
  const google = createGoogle({ ...shared, baseURL: `${baseURL}/google/v1beta`, apiKey })
  // Image results keep no response body, so each call gets a client whose fetch reads the cost from the response.
  const images = {
    openai: (modelId: string, fetch: FetchFunction) =>
      createOpenAI({ ...shared, fetch, baseURL: `${baseURL}/openai/v1`, apiKey }).image(modelId),
    google: (modelId: string, fetch: FetchFunction) =>
      createGoogle({ ...shared, fetch, baseURL: `${baseURL}/google/v1beta`, apiKey }).image(modelId),
    xai: (modelId: string, fetch: FetchFunction) =>
      createXai({ ...shared, fetch, baseURL: `${baseURL}/xai/v1`, apiKey }).image(modelId),
  } satisfies Record<OpenCodeImageAPI, (modelId: string, fetch: FetchFunction) => ImageModelV4>

  const clients = {
    messages: (modelId: string) => anthropic.messages(modelId),
    responses: (modelId: string) => openai.responses(modelId),
    chat: (modelId: string) => compatible.chatModel(modelId),
    google: (modelId: string) => google.languageModel(modelId),
  } satisfies Record<OpenCodeProtocol, (modelId: string) => LanguageModelV4>
  const languageModel = (modelId: string) => withUsage(clients[protocol(modelId)](modelId))
  const embeddingModel = (modelId: string) => withEmbeddingUsage(openai.embedding(modelId))

  return Object.assign((modelId: string) => languageModel(modelId), {
    specificationVersion: "v4" as const,
    languageModel,
    messages: (modelId: string) => withUsage(clients.messages(modelId)),
    responses: (modelId: string) => withUsage(clients.responses(modelId)),
    chat: (modelId: string) => withUsage(clients.chat(modelId)),
    google: (modelId: string) => withUsage(clients.google(modelId)),
    embeddingModel,
    textEmbeddingModel: embeddingModel,
    imageModel: (modelId: string) =>
      withImageUsage((fetch) => images[imageAPI(modelId)](modelId, fetch), settings.fetch ?? globalThis.fetch),
  })
}

export const opencode = createOpenCode()

/**
 * The model's native API from the list built into this release. A model the list doesn't know, such as a workspace
 * connection's or one released since, is guessed from its name; the gateway translates a wrong guess, losing only
 * what the two APIs don't share.
 */
export function protocol(modelId: string): OpenCodeProtocol {
  const known: Partial<Record<string, OpenCodeProtocol>> = models
  const listed = known[modelId]
  if (listed !== undefined) return listed
  const name = modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase()
  if (name.startsWith("claude")) return "messages"
  if (/^(gpt-(?!oss)|o\d)/.test(name)) return "responses"
  if (name.startsWith("gemini")) return "google"
  return "chat"
}

/** The image model's API from the list built into this release, else guessed from its name. */
export function imageAPI(modelId: string): OpenCodeImageAPI {
  const known: Partial<Record<string, OpenCodeImageAPI>> = imageModels
  const listed = known[modelId]
  if (listed !== undefined) return listed
  const name = modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase()
  if (name.startsWith("gemini")) return "google"
  if (name.startsWith("grok")) return "xai"
  return "openai"
}

// Each response carries its cost beside the usage its protocol reports: Chat and Responses in `usage` (a Responses
// stream in `response.completed`'s `response.usage`), Messages in `message_delta`'s `usage`, Gemini in `usageMetadata`.
const Billing = z.object({
  cost: z.number().optional(),
  opencode: z.object({
    billing_source: z.string(),
    list_cost: z.number(),
    estimated: z.boolean().optional(),
    allowance: z.number().optional(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache_read: z.number(),
      cache_write_5m: z.number(),
      cache_write_1h: z.number(),
    }),
  }),
})

const Frame = z.object({
  usage: z.unknown().optional(),
  usageMetadata: z.unknown().optional(),
  response: z.object({ usage: z.unknown().optional() }).optional(),
})

function readUsage(body: unknown): OpenCodeUsage | undefined {
  const frame = Frame.safeParse(body)
  if (!frame.success) return undefined
  const billing = [frame.data.usage, frame.data.usageMetadata, frame.data.response?.usage]
    .map((value) => Billing.safeParse(value))
    .find((result) => result.success)?.data
  if (billing === undefined) return undefined
  return {
    ...(billing.cost === undefined ? {} : { cost: billing.cost }),
    listCost: billing.opencode.list_cost,
    billingSource: billing.opencode.billing_source,
    ...(billing.opencode.estimated === undefined ? {} : { estimated: billing.opencode.estimated }),
    ...(billing.opencode.allowance === undefined ? {} : { allowance: billing.opencode.allowance }),
    tokens: {
      input: billing.opencode.tokens.input,
      output: billing.opencode.tokens.output,
      reasoning: billing.opencode.tokens.reasoning,
      cacheRead: billing.opencode.tokens.cache_read,
      cacheWrite5m: billing.opencode.tokens.cache_write_5m,
      cacheWrite1h: billing.opencode.tokens.cache_write_1h,
    },
  }
}

function addUsage(metadata: SharedV4ProviderMetadata | undefined, usage: OpenCodeUsage | undefined) {
  if (usage === undefined) return metadata
  return { ...metadata, opencode: { ...metadata?.opencode, usage: { ...usage, tokens: { ...usage.tokens } } } }
}

function withUsage(model: LanguageModelV4): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
      return model.supportedUrls
    },
    doGenerate: async (options) => {
      const result = await model.doGenerate(options)
      return { ...result, providerMetadata: addUsage(result.providerMetadata, readUsage(result.response?.body)) }
    },
    doStream: async (options) => {
      // Raw chunks are the only place the cost survives every protocol's parser; they're dropped again unless asked for.
      const result = await model.doStream({ ...options, includeRawChunks: true })
      const state: { usage?: OpenCodeUsage } = {}
      const stream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "raw") {
              state.usage = readUsage(part.rawValue) ?? state.usage
              if (options.includeRawChunks) controller.enqueue(part)
              return
            }
            if (part.type === "finish") {
              controller.enqueue({ ...part, providerMetadata: addUsage(part.providerMetadata, state.usage) })
              return
            }
            controller.enqueue(part)
          },
        }),
      )
      return { ...result, stream }
    },
  }
}

function withImageUsage(create: (fetch: FetchFunction) => ImageModelV4, fetch: FetchFunction): ImageModelV4 {
  const model = create(fetch)
  return {
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    get maxImagesPerCall() {
      return model.maxImagesPerCall
    },
    get supportsFileInputs() {
      return model.supportsFileInputs
    },
    get supportsMaskInputs() {
      return model.supportsMaskInputs
    },
    doGenerate: async (options) => {
      const state: { usage?: OpenCodeUsage } = {}
      const capture = async (...args: Parameters<FetchFunction>) => {
        const response = await fetch(...args)
        state.usage =
          readUsage(
            await response
              .clone()
              .json()
              .catch(() => undefined),
          ) ?? state.usage
        return response
      }
      const result = await create(Object.assign(capture, { preconnect: fetch.preconnect })).doGenerate(options)
      if (state.usage === undefined) return result
      return {
        ...result,
        providerMetadata: {
          ...result.providerMetadata,
          opencode: {
            images: result.images.map(() => ({})),
            usage: { ...state.usage, tokens: { ...state.usage.tokens } },
          },
        },
      }
    },
  }
}

function withEmbeddingUsage(model: EmbeddingModelV4): EmbeddingModelV4 {
  return {
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    get maxEmbeddingsPerCall() {
      return model.maxEmbeddingsPerCall
    },
    get supportsParallelCalls() {
      return model.supportsParallelCalls
    },
    doEmbed: async (options) => {
      const result = await model.doEmbed(options)
      return { ...result, providerMetadata: addUsage(result.providerMetadata, readUsage(result.response?.body)) }
    },
  }
}
