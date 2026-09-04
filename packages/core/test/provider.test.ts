import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@opencode-ai/core/provider"

describe("Provider", () => {
  test("loads bundled native provider entrypoints", async () => {
    const packages = [
      "@opencode-ai/ai/providers/cerebras",
      "@opencode-ai/ai/providers/deepinfra",
      "@opencode-ai/ai/providers/google-vertex",
      "@opencode-ai/ai/providers/google-vertex/gemini",
      "@opencode-ai/ai/providers/google-vertex/chat",
      "@opencode-ai/ai/providers/google-vertex/responses",
      "@opencode-ai/ai/providers/google-vertex/messages",
      "@opencode-ai/ai/providers/groq",
      "@opencode-ai/ai/providers/mistral",
      "@opencode-ai/ai/providers/togetherai",
    ]

    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })
})
