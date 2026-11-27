import { Effect, Schema } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { ProviderShared } from "../protocols/shared.js"
import { Provider } from "../provider.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type ProviderOptions = Pick<OpenAIProviderOptionsInput, "reasoningEffort"> & {
  /** Controls visible reasoning on GPT-OSS; other models always use parsed reasoning. */
  readonly includeReasoning?: boolean
  readonly parallelToolCalls?: boolean
  readonly serviceTier?: "on_demand" | "flex" | "auto" | "performance" | (string & {})
  readonly user?: string
}

export type Settings = ProviderPackage.Settings &
  ProviderOptions & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const Options = Schema.Struct({
  includeReasoning: Schema.optional(Schema.Boolean),
  user: Schema.optional(Schema.String),
})

export const chatCompletions = OpenAIChat.api
  .extend({
    id: "groq-chat",
    body: (request, base) =>
      Effect.gen(function* () {
        const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(
          request.providerOptions ?? {},
        )
        const gptOSS = request.model.id.startsWith("openai/gpt-oss-")
        return {
          ...(yield* base(request)),
          reasoning_format: gptOSS ? undefined : ("parsed" as const),
          include_reasoning: gptOSS ? options.includeReasoning : undefined,
          user: options.user,
        }
      }),
  })
  .configure({
    capabilities: {
      output: { maxTokensField: "max_completion_tokens" },
      reasoning: { field: "reasoning", required: false },
      tools: { strict: false },
    },
  })

export const groq = Provider.make({
  id: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  auth: Provider.apiKey("GROQ_API_KEY"),
  apis: [chatCompletions],
})

export const model = Provider.entrypoint<Settings, ProviderOptions>(groq)

export * as Groq from "./groq.js"
