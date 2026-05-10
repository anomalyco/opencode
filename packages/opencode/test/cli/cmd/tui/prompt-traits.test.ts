import { describe, expect, test } from "bun:test"
import { computePromptTraits } from "../../../../src/cli/cmd/tui/component/prompt/traits"

describe("computePromptTraits", () => {
  test("normal mode without autocomplete only captures tab", () => {
    const traits = computePromptTraits({ mode: "normal", disabled: false, autocompleteVisible: false })
    expect(traits.capture).toEqual(["tab"])
    expect(traits.suspend).toBe(false)
    expect(traits.status).toBeUndefined()
  })

  test("normal mode with autocomplete captures navigation keys", () => {
    const traits = computePromptTraits({ mode: "normal", disabled: false, autocompleteVisible: true })
    expect(traits.capture).toEqual(["escape", "navigate", "submit", "tab"])
    expect(traits.suspend).toBe(false)
    expect(traits.status).toBeUndefined()
  })

  test("shell mode does not suspend the textarea", () => {
    // Suspending the textarea would gate every keybinding action
    // (backspace, delete-word-backward, arrow movement, etc.) — see
    // @opentui/core 0.2.x TextareaRenderable.handleKeyPress. Shell mode is
    // an active editing mode, so suspend must stay off.
    const traits = computePromptTraits({ mode: "shell", disabled: false, autocompleteVisible: false })
    expect(traits.suspend).toBe(false)
  })

  test("shell mode disables capture and labels the prompt", () => {
    const traits = computePromptTraits({ mode: "shell", disabled: false, autocompleteVisible: false })
    expect(traits.capture).toBeUndefined()
    expect(traits.status).toBe("SHELL")
  })

  test("disabled suspends regardless of mode", () => {
    expect(computePromptTraits({ mode: "normal", disabled: true, autocompleteVisible: false }).suspend).toBe(true)
    expect(computePromptTraits({ mode: "shell", disabled: true, autocompleteVisible: false }).suspend).toBe(true)
  })
})
