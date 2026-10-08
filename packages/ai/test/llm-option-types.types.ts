import { Effect, Schema, Stream } from "effect"
import {
  LLM,
  type LLMClientService,
  type LanguageModel,
  type LanguageModelProviderOptions,
  type ProviderOptions,
} from "../src/index.js"
import { ai } from "../src/promise.js"
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

LLM.request({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
LLM.request({ model, prompt: "Hello", providerOptions: { future: { option: true } } })

const generated = LLM.generate(LLM.request({ model, prompt: "Hello" }))
type GenerateRequirements = Assert<Equal<Requirements<typeof generated>, LLMClientService>>
const streamed = LLM.stream(LLM.request({ model, prompt: "Hello" }))
type StreamClientRequirements = Assert<Equal<StreamRequirements<typeof streamed>, LLMClientService>>
const generatedFromInput = LLM.generate({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
type InputGenerateRequirements = Assert<Equal<Requirements<typeof generatedFromInput>, LLMClientService>>
const streamedFromInput = LLM.stream({ model, prompt: "Hello", providerOptions: { mode: "thorough" } })
type InputStreamRequirements = Assert<Equal<StreamRequirements<typeof streamedFromInput>, LLMClientService>>

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Known provider options preserve their value types.
  providerOptions: { mode: "slow" },
})

// @ts-expect-error Direct input keeps the selected model's provider option types.
LLM.generate({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
// @ts-expect-error Stream input keeps the selected model's provider option types.
LLM.stream({ model, prompt: "Hello", providerOptions: { mode: "slow" } })

const generatedObject = LLM.generateObject({
  model,
  prompt: "Hello",
  schema: Schema.Struct({ answer: Schema.String }),
  providerOptions: { mode: "thorough" },
})
type GenerateObjectRequirements = Assert<Equal<Requirements<typeof generatedObject>, LLMClientService>>

const generatedDynamicObject = LLM.generateObject({
  model,
  prompt: "Hello",
  jsonSchema: { type: "object" },
})
type GenerateDynamicObjectRequirements = Assert<Equal<Requirements<typeof generatedDynamicObject>, LLMClientService>>

LLM.generateObject({
  model,
  prompt: "Hello",
  jsonSchema: { type: "object" },
  // @ts-expect-error Dynamic object generation uses the selected model's provider options.
  providerOptions: { mode: false },
})

declare const generic: LanguageModel
LLM.request({ model: generic, prompt: "Hello", providerOptions: { arbitrary: { option: true } } })

const options: LanguageModelProviderOptions<typeof model> = { mode: "fast" }
void (options satisfies LanguageModelProviderOptions<typeof model>)
void (true satisfies GenerateRequirements)
void (true satisfies StreamClientRequirements)
void (true satisfies InputGenerateRequirements)
void (true satisfies InputStreamRequirements)
void (true satisfies GenerateObjectRequirements)
void (true satisfies GenerateDynamicObjectRequirements)

void ai.llm.generate({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
void ai.llm.stream({ model, prompt: "Hello", providerOptions: { mode: "thorough" } })
void ai.llm.generate(ai.llm.request({ model, prompt: "Hello" }))
void ai.llm.stream(ai.llm.request({ model, prompt: "Hello" }))
// @ts-expect-error Promise direct input keeps the selected model's provider option types.
void ai.llm.generate({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
// @ts-expect-error Promise stream input keeps the selected model's provider option types.
void ai.llm.stream({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
