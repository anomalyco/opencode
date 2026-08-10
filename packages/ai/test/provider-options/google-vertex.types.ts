import { LLM } from "../../src"
import { GoogleVertex } from "../../src/providers"

const model = GoogleVertex.provider.configure({ apiKey: "test" }).model("gemini-2.5-pro")

LLM.request({
  model,
  prompt: "Hello",
  providerOptions: { gemini: { thinkingConfig: { includeThoughts: true } } },
})

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Vertex Gemini includeThoughts must be boolean.
  providerOptions: { gemini: { thinkingConfig: { includeThoughts: "yes" } } },
})
