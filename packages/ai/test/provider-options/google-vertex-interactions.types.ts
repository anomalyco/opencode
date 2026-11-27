import { ai } from "../../src/effect.js"
import { GoogleVertexInteractions } from "../../src/providers.js"
import { model } from "../../src/providers/google-vertex/interactions.js"

const selected = GoogleVertexInteractions.model("gemini-3.8-flash", { project: "project" })

ai.request({
  model: selected,
  prompt: "Hello",
  providerOptions: { thinkingLevel: "low", thinkingSummaries: "auto", serviceTier: "flex", store: false },
})

ai.request({
  model: selected,
  prompt: "Hello",
  // @ts-expect-error Interactions store must be boolean.
  providerOptions: { store: "yes" },
})

model("gemini-3.8-flash", { apiKey: "key" })
model("gemini-3.8-flash", { project: "project", thinkingLevel: "low" })
// @ts-expect-error Package settings also reject conflicting credentials.
model("gemini-3.8-flash", { apiKey: "key", accessToken: "token" })
