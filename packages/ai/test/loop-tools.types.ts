import { Effect, Schema } from "effect"
import { ai, tool } from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { AI } from "../src/index.js"

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

const weather = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const shout = tool({
  description: "Shout text.",
  parameters: Schema.String,
  success: Schema.String,
  execute: (input) => Effect.succeed(input.toUpperCase()),
})

const schemaOnly = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

AI.ai.text.loop({ model, prompt: "Add 2 and 3.", tools: { add } })
AI.ai.text.loop({ model, prompt: "Get weather.", tools: { weather } })
AI.ai.text.loop({ model, prompt: "Use any tool.", tools: { add, echo, weather, shout } })
ai.text.loop({ model, prompt: "Add 2 and 3.", tools: { add } })
ai.text.loop({ model, prompt: "Get weather.", tools: { weather } })
ai.text.loop({ model, prompt: "Use any tool.", tools: { add, echo, weather, shout } })

// @ts-expect-error The loop runs tools, so each one needs an execute handler.
ai.text.loop({ model, prompt: "Get weather.", tools: { schemaOnly } })

const unavailable = () => {
  throw new Error("Unavailable.")
}
const fail = AI.tool({ description: "Fail.", parameters: Schema.String, execute: unavailable })
const parse = AI.tool({ description: "Parse.", parameters: Schema.String, execute: (text) => JSON.parse(text) })
const inspect = tool({ description: "Inspect.", parameters: Schema.String, execute: () => Effect.succeed<unknown>(1) })
AI.ai.text.loop({ model, prompt: "Fail.", tools: { fail, parse, inspect } })
