import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/core/model"

describe("Model.parse", () => {
  test("splits provider and model", () => {
    const parsed = Model.parse("opencode/gpt-5")
    expect(String(parsed.providerID)).toBe("opencode")
    expect(String(parsed.modelID)).toBe("gpt-5")
  })

  test("keeps slashes inside multi-segment model ids", () => {
    const parsed = Model.parse("@scope/pkg/gpt-5")
    expect(String(parsed.providerID)).toBe("@scope")
    expect(String(parsed.modelID)).toBe("pkg/gpt-5")
  })

  test("trims stray whitespace around the reference and segments", () => {
    const padded = Model.parse(" opencode/ deepseek-v4-flash ")
    expect(String(padded.providerID)).toBe("opencode")
    expect(String(padded.modelID)).toBe("deepseek-v4-flash")

    const tabbed = Model.parse("\topenai\n")
    expect(String(tabbed.providerID)).toBe("openai")
    expect(String(tabbed.modelID)).toBe("")
  })
})
