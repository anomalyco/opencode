import { describe, expect, test } from "bun:test"
import { Provider } from "@/provider/provider"

describe("ModelNotFoundError message", () => {
  test("never offers the rejected model id as its own suggestion", () => {
    const error = new Provider.ModelNotFoundError({
      providerID: "some-provider" as never,
      modelID: "gpt-sol" as never,
      suggestions: ["gpt-sol", "claude-code-gpt-sol"],
    })

    // A suggestion identical to the input tells the user their id is correct
    // while refusing it, which sends them looking for a typo that isn't there.
    expect(error.message).not.toMatch(/Did you mean: gpt-sol,/)
  })

  test("names the unregistered provider instead of blaming the model id", () => {
    const error = new Provider.ModelNotFoundError({
      providerID: "opencode-omniroute" as never,
      modelID: "gpt-sol" as never,
      providerMissing: true,
    })

    expect(error.message).toContain("Provider not registered: opencode-omniroute")
    expect(error.message).not.toContain("Model not found")
  })

  test("still reports an unknown model when the provider is registered", () => {
    const error = new Provider.ModelNotFoundError({
      providerID: "opencode-omniroute" as never,
      modelID: "typo-model" as never,
    })

    expect(error.message).toContain("Model not found: opencode-omniroute/typo-model")
  })
})
