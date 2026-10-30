import { Effect, Schema } from "effect"
import { LLM } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { Tool } from "../src/tool.js"
import { AI, ai } from "../src/index.js"

const model = OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" })

const add = AI.tool({
  description: "Add two numbers.",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  execute: (input) => input.a + input.b,
})

const echo = AI.tool({
  description: "Echo text.",
  parameters: Schema.String,
  execute: (input) => input.toUpperCase(),
})

const weather = Tool.make({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const shout = Tool.make({
  description: "Shout text.",
  parameters: Schema.String,
  success: Schema.String,
  execute: (input) => Effect.succeed(input.toUpperCase()),
})

const schemaOnly = Tool.make({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

ai.llm.loop({ model, prompt: "Add 2 and 3.", tools: { add } })
ai.llm.loop({ model, prompt: "Get weather.", tools: { weather } })
ai.llm.loop({ model, prompt: "Use any tool.", tools: { add, echo, weather, shout } })
LLM.loop({ model, prompt: "Add 2 and 3.", tools: { add } })
LLM.loop({ model, prompt: "Get weather.", tools: { weather } })
LLM.loop({ model, prompt: "Use any tool.", tools: { add, echo, weather, shout } })

// @ts-expect-error The loop runs tools, so each one needs an execute handler.
LLM.loop({ model, prompt: "Get weather.", tools: { schemaOnly } })
