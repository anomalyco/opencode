import { ai } from "../../src/effect.js"
import { GoogleVertex } from "../../src/providers.js"

const model = GoogleVertex.model("gemini-2.5-pro", { apiKey: "test" })

ai.request({
  model,
  prompt: "Hello",
  providerOptions: { thinkingConfig: { includeThoughts: true } },
})

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Gemini includeThoughts must be boolean.
  providerOptions: { thinkingConfig: { includeThoughts: "yes" } },
})
