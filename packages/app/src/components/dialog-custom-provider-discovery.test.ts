import { describe, expect, test } from "bun:test"
import { parseDiscoveredModels } from "./dialog-custom-provider-discovery"

describe("parseDiscoveredModels", () => {
  test("parses OpenAI-style data arrays", () => {
    expect(
      parseDiscoveredModels({
        data: [
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-4o-mini" },
          { id: "gpt-4o" },
          { id: "", name: "skip" },
        ],
      }),
    ).toEqual([
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini" },
    ])
  })

  test("falls back to models arrays", () => {
    expect(
      parseDiscoveredModels({
        models: [
          { id: "claude-sonnet", name: "Claude Sonnet" },
          { id: "claude-haiku", name: "" },
        ],
      }),
    ).toEqual([
      { id: "claude-sonnet", name: "Claude Sonnet" },
      { id: "claude-haiku", name: "claude-haiku" },
    ])
  })
})