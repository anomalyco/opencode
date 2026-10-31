import { ai } from "../../src/effect.js"
import { googleVertexInteractions } from "../../src/providers.js"
import { Auth } from "../../src/route/auth.js"
import { model } from "../../src/providers/google-vertex/interactions.js"

const selected = googleVertexInteractions.configure({ project: "project" })("gemini-3.8-flash")

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

googleVertexInteractions.configure({ auth: Auth.bearer("token"), project: "project" })
googleVertexInteractions.configure({ apiKey: "key" })
// @ts-expect-error API keys and OAuth credentials are mutually exclusive.
googleVertexInteractions.configure({ apiKey: "key", accessToken: "token" })
// @ts-expect-error API keys and auth overrides are mutually exclusive.
googleVertexInteractions.configure({ apiKey: "key", auth: Auth.bearer("token") })
model("gemini-3.8-flash", { project: "project", thinkingLevel: "low" })
// @ts-expect-error Package settings also reject conflicting credentials.
model("gemini-3.8-flash", { apiKey: "key", accessToken: "token" })
