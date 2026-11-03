import { Effect, Schema, Stream } from "effect"
import {
  ai,
  type Finish,
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
type Success<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type StreamEvent<T> = T extends Stream.Stream<infer A, infer _E, infer _R> ? A : never
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

const generatedObject = ai.generate({
  model,
  prompt: "Hello",
  schema: Schema.Struct({ answer: Schema.String }),
  providerOptions: { mode: "thorough" },
})
type StructuredOutputRequirements = Assert<Equal<Requirements<typeof generatedObject>, LLMClientService>>
type StructuredOutputValue = Assert<Equal<Success<typeof generatedObject>["object"], { readonly answer: string }>>
type StructuredOutputText = Assert<Equal<Success<typeof generatedObject>["text"], string>>

const generatedDynamicObject = ai.generate({
  model,
  prompt: "Hello",
  schema: { type: "object" },
})
type GenerateDynamicObjectRequirements = Assert<Equal<Requirements<typeof generatedDynamicObject>, LLMClientService>>
type GenerateDynamicObjectValue = Assert<Equal<Success<typeof generatedDynamicObject>["object"], unknown>>

// @ts-expect-error Structured output keeps the selected model's provider options.
ai.generate({ model, prompt: "Hello", schema: { type: "object" }, providerOptions: { mode: false } })

// @ts-expect-error A plain request has no decoded object.
void ai.generate({ model, prompt: "Hello" }).pipe(Effect.map((response) => response.object))

type FinishObject<T> = Extract<T, { readonly type: "finish" }> extends { readonly object?: infer O } ? O : never
const streamedObject = ai.stream({ model, prompt: "Hello", schema: Schema.Struct({ answer: Schema.String }) })
type StreamObjectValue = Assert<Equal<FinishObject<StreamEvent<typeof streamedObject>>, { readonly answer: string }>>
const loopedObject = ai.loop({ model, prompt: "Hello", tools: [], schema: Schema.Struct({ answer: Schema.String }) })
type LoopObjectValue = Assert<
  Equal<
    Extract<StreamEvent<typeof loopedObject>, { readonly type: "finish" }>,
    Finish & { readonly object?: { readonly answer: string } }
  >
>

declare const generic: LanguageModel
ai.request({ model: generic, prompt: "Hello", providerOptions: { arbitrary: { option: true } } })

const options: LanguageModelProviderOptions<typeof model> = { mode: "fast" }
void (options satisfies LanguageModelProviderOptions<typeof model>)
void (true satisfies GenerateRequirements)
void (true satisfies StreamClientRequirements)
void (true satisfies InputGenerateRequirements)
void (true satisfies InputStreamRequirements)
void (true satisfies StructuredOutputRequirements)
void (true satisfies GenerateDynamicObjectRequirements)
void (true satisfies StructuredOutputValue)
void (true satisfies StructuredOutputText)
void (true satisfies GenerateDynamicObjectValue)
void (true satisfies StreamObjectValue)
void (true satisfies LoopObjectValue)

void AI.ai
  .generate({ model, prompt: "Hello", schema: Schema.Struct({ answer: Schema.String }) })
  .then((response) => response.object.answer satisfies string)
void AI.ai.generate({ model, prompt: "Hello", providerOptions: { mode: "fast" } })
void AI.ai.stream({ model, prompt: "Hello", providerOptions: { mode: "thorough" } })
void AI.ai.generate(AI.ai.request({ model, prompt: "Hello" }))
void AI.ai.stream(AI.ai.request({ model, prompt: "Hello" }))
// @ts-expect-error Promise direct input keeps the selected model's provider option types.
void AI.ai.generate({ model, prompt: "Hello", providerOptions: { mode: "slow" } })
// @ts-expect-error Promise stream input keeps the selected model's provider option types.
void AI.ai.stream({ model, prompt: "Hello", providerOptions: { mode: "slow" } })

ai.request({ model, system: "Be brief.", prompt: "Hello" })
ai.request({ model, system: "Be brief.", messages: [] })
// @ts-expect-error A request needs `prompt` or `messages`.
ai.request({ model })
// @ts-expect-error A request takes `prompt` or `messages`, not both.
ai.request({ model, prompt: "Hello", messages: [] })
// @ts-expect-error Effect generate needs `prompt` or `messages`.
ai.generate({ model, system: "Be brief." })
// @ts-expect-error Effect stream takes `prompt` or `messages`, not both.
ai.stream({ model, prompt: "Hello", messages: [] })
// @ts-expect-error Effect loop needs `prompt` or `messages`.
ai.loop({ model, tools: [] })
// @ts-expect-error Effect structured output takes `prompt` or `messages`, not both.
ai.generate({ model, prompt: "Hello", messages: [], schema: Schema.String })
// @ts-expect-error Promise generate needs `prompt` or `messages`.
void AI.ai.generate({ model })
// @ts-expect-error Promise stream takes `prompt` or `messages`, not both.
AI.ai.stream({ model, prompt: "Hello", messages: [] })
// @ts-expect-error Promise loop takes `prompt` or `messages`, not both.
AI.ai.loop({ model, prompt: "Hello", messages: [], tools: [] })
AI.ai.loop({ model, messages: [], tools: [] })
