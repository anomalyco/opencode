import { Effect, Schema, Stream } from "effect"
import {
  LLM,
  type LLMClientService,
  type LanguageModel,
  type LanguageModelProviderOptions,
  type ProviderOptions,
} from "../src"
import { OpenAIChat } from "../src/protocols"

interface ExampleOptions {
  readonly [key: string]: unknown
  readonly mode?: "fast" | "thorough"
}

type ExampleProviderOptions = ProviderOptions & {
  readonly example?: ExampleOptions
}

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://example.com/v1" } })
  .model<ExampleProviderOptions>({ id: "example" })

type Requirements<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never
type StreamRequirements<T> = T extends Stream.Stream<infer _A, infer _E, infer R> ? R : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

LLM.request({ model, prompt: "Hello", providerOptions: { example: { mode: "fast" } } })
LLM.request({ model, prompt: "Hello", providerOptions: { future: { option: true } } })

const generated = LLM.generate(LLM.request({ model, prompt: "Hello" }))
type GenerateRequirements = Assert<Equal<Requirements<typeof generated>, LLMClientService>>
const streamed = LLM.stream(LLM.request({ model, prompt: "Hello" }))
type StreamClientRequirements = Assert<Equal<StreamRequirements<typeof streamed>, LLMClientService>>

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Known provider options preserve their value types.
  providerOptions: { example: { mode: "slow" } },
})

const generatedObject = LLM.generateObject({
  model,
  prompt: "Hello",
  schema: Schema.Struct({ answer: Schema.String }),
  providerOptions: { example: { mode: "thorough" } },
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
  providerOptions: { example: { mode: false } },
})

declare const generic: LanguageModel
LLM.request({ model: generic, prompt: "Hello", providerOptions: { arbitrary: { option: true } } })

const options: LanguageModelProviderOptions<typeof model> = { example: { mode: "fast" } }
void (options satisfies LanguageModelProviderOptions<typeof model>)
void (true satisfies GenerateRequirements)
void (true satisfies StreamClientRequirements)
void (true satisfies GenerateObjectRequirements)
void (true satisfies GenerateDynamicObjectRequirements)
