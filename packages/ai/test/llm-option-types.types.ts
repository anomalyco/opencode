import { Schema } from "effect"
import { LLM, type Model, type ModelProviderOptions, type ProviderOptions } from "../src"
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

LLM.request({ model, prompt: "Hello", providerOptions: { example: { mode: "fast" } } })
LLM.request({ model, prompt: "Hello", providerOptions: { future: { option: true } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Known provider options preserve their value types.
  providerOptions: { example: { mode: "slow" } },
})

LLM.generateObject({
  model,
  prompt: "Hello",
  schema: Schema.Struct({ answer: Schema.String }),
  providerOptions: { example: { mode: "thorough" } },
})

LLM.generateObject({
  model,
  prompt: "Hello",
  jsonSchema: { type: "object" },
  // @ts-expect-error Dynamic object generation uses the selected model's provider options.
  providerOptions: { example: { mode: false } },
})

declare const generic: Model
LLM.request({ model: generic, prompt: "Hello", providerOptions: { arbitrary: { option: true } } })

const options: ModelProviderOptions<typeof model> = { example: { mode: "fast" } }
void options
