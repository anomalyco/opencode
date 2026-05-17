import { describe, expect, test } from "bun:test"
import { shouldOpenVariantDialog } from "../../../../src/cli/cmd/tui/component/dialog-model"

describe("DialogModel variant routing", () => {
  test("checks variants for the selected model instead of the previous current model", () => {
    const calls: Array<{ providerID: string; modelID: string } | undefined> = []
    const selected = { providerID: "openai", modelID: "gpt-5.4" }

    const shouldOpen = shouldOpenVariantDialog(selected, {
      list(model) {
        calls.push(model)
        return model?.modelID === selected.modelID ? ["low", "medium", "high"] : []
      },
      selected(model) {
        calls.push(model)
        return model?.modelID === selected.modelID ? undefined : "default"
      },
    })

    expect(shouldOpen).toBe(true)
    expect(calls).toEqual([selected, selected])
  })

  test("keeps the model dialog closed when a variant choice is already saved", () => {
    const selected = { providerID: "openai", modelID: "gpt-5.4" }

    expect(
      shouldOpenVariantDialog(selected, {
        list: () => ["low", "medium", "high"],
        selected: () => "medium",
      }),
    ).toBe(false)

    expect(
      shouldOpenVariantDialog(selected, {
        list: () => ["low", "medium", "high"],
        selected: () => "default",
      }),
    ).toBe(false)
  })
})
