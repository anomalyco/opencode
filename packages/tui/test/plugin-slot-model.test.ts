import { describe, expect, test } from "bun:test"
import type { SlotMap } from "@opencode/plugin/tui"

const model = { providerID: "deepseek", modelID: "deepseek-chat" } as const

const inputs = {
  home: { model } satisfies SlotMap["home.footer.status"],
  prompt: {
    sessionID: "ses_test",
    mode: "normal",
    showDetails: true,
    model,
  } satisfies SlotMap["prompt.footer.status"],
  sidebar: { sessionID: "ses_test", model } satisfies SlotMap["sidebar.content"],
  sidebarFooter: { sessionID: "ses_test", model } satisfies SlotMap["sidebar.footer"],
}

describe("plugin slot model input", () => {
  test("preserves the selected provider and model IDs", () => {
    expect(inputs.home.model).toEqual(model)
    expect(inputs.prompt.model).toEqual(model)
    expect(inputs.sidebar.model).toEqual(model)
    expect(inputs.sidebarFooter.model).toEqual(model)
  })
})
