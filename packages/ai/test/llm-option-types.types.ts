import { Effect, Schema, Stream } from "effect"
import {
  ai,
  type LanguageModel,
  type LanguageModelProviderOptions,
  type LLMClientService,
  type ProviderOptions,
} from "../src/effect.js"
import { AI } from "../src/index.js"
import { OpenAIChat } from "../src/protocols.js"

interface ExampleOptions {
  readonly [key: string]: unknown
  readonly mode?: "fast" | "thorough"
}

type ExampleProviderOptions = ProviderOptions & ExampleOptions

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://example.com/v1" } })
  .model<ExampleProviderOptions>({ id: "example" })

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type StreamRequirements<T> = T extends Stream.Stream<infer _A, infer _E, infer R> ? R : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

ai.request({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
ai.request({ model, prompt: "Hello", providerOptions: { future: { option: true } } })

const generated = ai.generate(ai.request({ model, prompt: "Hello" }))
type GenerateRequirements = Assert<Equal<Requirements<typeof generated>, LLMClientService>>
const streamed = ai.stream(ai.request({ model, prompt: "Hello" }))
type StreamClientRequirements = Assert<Equal<StreamRequirements<typeof streamed>, LLMClientService>>
const generatedFromInput = ai.generate({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
type InputGenerateRequirements = Assert<Equal<Requirements<typeof generatedFromInput>, LLMClientService>>
const streamedFromInput = ai.stream({ model, prompt: "Hello", providerOptions: { mode: "thorough" } })
type InputStreamRequirements = Assert<Equal<StreamRequirements<typeof streamedFromInput>, LLMClientService>>

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Known provider options preserve their value types.
  providerOptions: { mode: "slow" },
})

// @ts-expect-error Direct input keeps the selected model's provider option types.
ai.generate({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
// @ts-expect-error Stream input keeps the selected model's provider option types.
ai.stream({ model, prompt: "Hello", providerOptions: { mode: "slow" } })

const generatedObject = ai.generateObject({
  model,
  prompt: "Hello",
  schema: Schema.Struct({ answer: Schema.String }),
  providerOptions: { mode: "thorough" },
})
type GenerateObjectRequirements = Assert<Equal<Requirements<typeof generatedObject>, LLMClientService>>

const generatedDynamicObject = ai.generateObject({
  model,
  prompt: "Hello",
  jsonSchema: { type: "object" },
})
type GenerateDynamicObjectRequirements = Assert<Equal<Requirements<typeof generatedDynamicObject>, LLMClientService>>

ai.generateObject({
  model,
  prompt: "Hello",
  jsonSchema: { type: "object" },
  // @ts-expect-error Dynamic object generation uses the selected model's provider options.
  providerOptions: { mode: false },
})

declare const generic: LanguageModel
ai.request({ model: generic, prompt: "Hello", providerOptions: { arbitrary: { option: true } } })

const options: LanguageModelProviderOptions<typeof model> = { mode: "fast" }
void (options satisfies LanguageModelProviderOptions<typeof model>)
void (true satisfies GenerateRequirements)
void (true satisfies StreamClientRequirements)
void (true satisfies InputGenerateRequirements)
void (true satisfies InputStreamRequirements)
void (true satisfies GenerateObjectRequirements)
void (true satisfies GenerateDynamicObjectRequirements)

void AI.ai.generate({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
void AI.ai.stream({ model, prompt: "Hello", providerOptions: { mode: "thorough" } })
void AI.ai.generate(AI.ai.request({ model, prompt: "Hello" }))
void AI.ai.stream(AI.ai.request({ model, prompt: "Hello" }))
// @ts-expect-error Promise direct input keeps the selected model's provider option types.
void AI.ai.generate({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
// @ts-expect-error Promise stream input keeps the selected model's provider option types.
void AI.ai.stream({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
