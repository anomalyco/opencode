import { describe, expect, test } from "bun:test"
import { resolveSubagentVariant } from "../../../src/routes/session/subagent-footer"

const sessionModel = {
  id: "gpt-5.6-sol",
  providerID: "openai",
  variant: "default",
}

const model = {
  variants: {
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
  },
}

describe("subagent footer variant", () => {
  test("prefers the persisted non-default variant", () => {
    const result = resolveSubagentVariant({ ...sessionModel, variant: "xhigh" }, undefined, undefined)

    expect(result).toBe("xhigh")
  })

  test("uses the matching agent variant for a legacy session", () => {
    const result = resolveSubagentVariant(
      sessionModel,
      {
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        variant: "high",
        options: {},
      },
      model,
    )

    expect(result).toBe("high")
  })

  test("falls back to a supported reasoning effort", () => {
    const result = resolveSubagentVariant(
      sessionModel,
      {
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        options: { reasoningEffort: "medium" },
      },
      model,
    )

    expect(result).toBe("medium")
  })

  test("omits configuration for a different model", () => {
    const result = resolveSubagentVariant(
      sessionModel,
      {
        model: { providerID: "openai", modelID: "gpt-5.6-terra" },
        variant: "high",
        options: { reasoningEffort: "medium" },
      },
      model,
    )

    expect(result).toBeUndefined()
  })

  test("omits unsupported configured levels", () => {
    const result = resolveSubagentVariant(
      sessionModel,
      {
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        variant: "max",
        options: { reasoningEffort: "minimal" },
      },
      model,
    )

    expect(result).toBeUndefined()
  })

  test("falls through an unsupported agent variant to reasoning effort", () => {
    const result = resolveSubagentVariant(
      sessionModel,
      {
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
        variant: "max",
        options: { reasoningEffort: "high" },
      },
      model,
    )

    expect(result).toBe("high")
  })
})
