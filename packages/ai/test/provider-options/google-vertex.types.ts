import { ai } from "../../src/effect.js"
import { googleVertex } from "../../src/providers.js"

const model = googleVertex.configure({ apiKey: "test" })("gemini-2.5-pro")

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
