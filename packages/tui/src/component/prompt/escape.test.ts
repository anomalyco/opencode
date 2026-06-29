import { describe, expect, test } from "bun:test"
import { promptEscapeAction } from "./escape"

const base = {
  autocompleteVisible: false,
  disabled: false,
  focused: true,
  mode: "normal" as const,
  promptInput: "next prompt",
  sessionBusy: true,
  workspaceCreating: false,
}

describe("promptEscapeAction", () => {
  test("submits the focused normal prompt after interrupting a busy session", () => {
    expect(promptEscapeAction(base)).toBe("interrupt-submit")
  })

  test("keeps escape as a plain interrupt when there is no sendable prompt", () => {
    expect(promptEscapeAction({ ...base, promptInput: "   " })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, sessionBusy: false })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, focused: false })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, disabled: true })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, autocompleteVisible: true })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, workspaceCreating: true })).toBe("interrupt")
    expect(promptEscapeAction({ ...base, mode: "shell" })).toBe("interrupt")
  })
})
