import { describe, expect, test } from "bun:test"
import { questionEnter, type QuestionSubmitKey } from "./question-keys"

describe("questionEnter", () => {
  const enter = (
    submit: QuestionSubmitKey,
    keys: { shift?: boolean; meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
  ) =>
    questionEnter(
      {
        key: "Enter",
        keyCode: 13,
        repeat: false,
        metaKey: keys.meta ?? false,
        ctrlKey: keys.ctrl ?? false,
        altKey: keys.alt ?? false,
        shiftKey: keys.shift ?? false,
        isComposing: false,
      },
      submit,
    )

  test("Enter submits and Shift+Enter selects by default", () => {
    expect(enter("enter")).toBe("submit")
    expect(enter("enter", { shift: true })).toBe("select")
  })

  test("Enter selects when Cmd/Ctrl+Enter submits", () => {
    expect(enter("mod+enter")).toBe("select")
    expect(enter("mod+enter", { shift: true })).toBe("select")
  })

  test("Cmd/Ctrl+Enter submits either way, and Alt+Enter does nothing", () => {
    expect(enter("enter", { meta: true })).toBe("submit")
    expect(enter("mod+enter", { ctrl: true })).toBe("submit")
    expect(enter("enter", { alt: true })).toBeUndefined()
  })

  test("other keys and IME confirmations do nothing", () => {
    const key = { keyCode: 0, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
    expect(questionEnter({ ...key, key: " ", isComposing: false }, "enter")).toBeUndefined()
    expect(questionEnter({ ...key, key: "Enter", isComposing: true }, "enter")).toBeUndefined()
    expect(questionEnter({ ...key, key: "Enter", keyCode: 229, isComposing: false }, "enter")).toBeUndefined()
  })
})
