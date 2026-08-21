import { describe, expect, test } from "bun:test"
import { resolveSessionComposerSelection } from "./selection"

describe("resolveSessionComposerSelection", () => {
  test("prefers durable Session state over historical message metadata", () => {
    expect(
      resolveSessionComposerSelection(
        { agent: "build", model: { id: "claude", providerID: "anthropic" } },
        { agent: "review", model: { modelID: "gpt", providerID: "openai" } },
      ),
    ).toEqual({
      agent: "build",
      model: { modelID: "claude", providerID: "anthropic", variant: undefined },
    })
  })

  test("falls back to historical metadata while durable state is unavailable", () => {
    expect(
      resolveSessionComposerSelection(undefined, {
        agent: "review",
        model: { modelID: "gpt", providerID: "openai", variant: "high" },
      }),
    ).toEqual({
      agent: "review",
      model: { modelID: "gpt", providerID: "openai", variant: "high" },
    })
  })
})
