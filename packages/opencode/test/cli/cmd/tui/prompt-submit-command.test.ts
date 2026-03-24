import { describe, expect, mock, test } from "bun:test"

import { createSubmitPromptCommand } from "../../../../src/cli/cmd/tui/component/prompt/submit-command"

describe("prompt submit command", () => {
  test("does not bind Enter globally", () => {
    const command = createSubmitPromptCommand({
      isInputFocused: () => true,
      submit: () => {},
    })

    expect(command.keybind).toBeUndefined()
  })

  test("submits and clears dialog when the prompt is focused", () => {
    const submit = mock(() => {})
    const clear = mock(() => {})
    const command = createSubmitPromptCommand({
      isInputFocused: () => true,
      submit,
    })

    command.onSelect?.({ clear } as any)

    expect(submit).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  test("does nothing when the prompt is not focused", () => {
    const submit = mock(() => {})
    const clear = mock(() => {})
    const command = createSubmitPromptCommand({
      isInputFocused: () => false,
      submit,
    })

    command.onSelect?.({ clear } as any)

    expect(submit).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
