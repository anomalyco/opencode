import { Effect, Schema } from "effect"
import { LLM } from "../src"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { tool } from "../src/tool"

const request = LLM.request({
  model: OpenAIChat.model({ id: "gpt-4o-mini", apiKey: "fixture" }),
  prompt: "Use the tool.",
})

const executable = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const schemaOnly = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

LLM.stream({ request, tools: { executable } })
LLM.generate({ request, tools: { executable }, stopWhen: LLM.stepCountIs(2) })
LLM.stream({ request, tools: { schemaOnly }, toolExecution: "none" })

// @ts-expect-error Handler-less tools can only be passed with toolExecution: "none".
LLM.stream({ request, tools: { schemaOnly } })
