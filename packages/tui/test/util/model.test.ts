import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { label, parse } from "../../src/util/model"

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-5", url: "https://example.com/claude-sonnet-4-5", npm: "@ai-sdk/anthropic" },
        name: "Claude Sonnet 4.5",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 200_000, output: 8_192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-09-29",
      },
    },
  },
]

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })

  test("labels a model by display name or by provider and model id", () => {
    expect(label(providers, "anthropic", "claude-sonnet-4-5", undefined)).toBe("Claude Sonnet 4.5")
    expect(label(providers, "anthropic", "claude-sonnet-4-5", "name")).toBe("Claude Sonnet 4.5")
    expect(label(providers, "anthropic", "claude-sonnet-4-5", "id")).toBe("anthropic/claude-sonnet-4-5")
    expect(label(providers, "gateway", "org/model", "id")).toBe("gateway/org/model")
    expect(label(providers, "gateway", "org/model", "name")).toBe("org/model")
  })
})
