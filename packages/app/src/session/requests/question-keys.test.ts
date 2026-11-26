import { describe, expect, test } from "bun:test"
import { questionEnter, questionKey, type QuestionKeyZone, type QuestionSubmitKey } from "./question-keys"

const press = (
  key: string,
  options: {
    zone?: QuestionKeyZone
    mac?: boolean
    count?: number
    repeat?: boolean
    meta?: boolean
    alt?: boolean
    shift?: boolean
    composing?: boolean
    keyCode?: number
    submit?: QuestionSubmitKey
  } = {},
) =>
  questionKey(
    {
      key,
      repeat: options.repeat ?? false,
      metaKey: options.meta ?? false,
      ctrlKey: false,
      altKey: options.alt ?? false,
      shiftKey: options.shift ?? false,
      isComposing: options.composing ?? false,
      keyCode: options.keyCode ?? 0,
    },
    {
      mac: options.mac ?? true,
      zone: options.zone ?? "option",
      count: options.count ?? 3,
      submit: options.submit ?? "enter",
    },
  )

describe("questionKey", () => {
  test("Enter and Escape that confirm or cancel an IME composition do nothing", () => {
    expect(press("Escape", { composing: true })).toEqual({ type: "none" })
    expect(press("Enter", { composing: true, meta: true })).toEqual({ type: "none" })
    expect(press("Escape", { keyCode: 229 })).toEqual({ type: "none" })
    expect(press("Enter", { keyCode: 229, meta: true })).toEqual({ type: "none" })
    expect(press("Escape")).toEqual({ type: "dismiss" })
  })

  test("Up and Down move the highlight", () => {
    expect(press("ArrowDown")).toEqual({ type: "move", step: 1 })
    expect(press("ArrowUp", { zone: "custom" })).toEqual({ type: "move", step: -1 })
    expect(press("Home")).toEqual({ type: "edge", to: "first" })
    expect(press("End")).toEqual({ type: "edge", to: "last" })
  })

  test("Left and Right switch questions anywhere but the text field", () => {
    expect(press("ArrowRight")).toEqual({ type: "question", step: 1 })
    expect(press("ArrowLeft", { zone: "custom" })).toEqual({ type: "question", step: -1 })
    expect(press("ArrowRight", { zone: "other" })).toEqual({ type: "question", step: 1 })
    expect(press("ArrowLeft", { zone: "input" })).toEqual({ type: "none" })
    expect(press("ArrowRight", { zone: "input" })).toEqual({ type: "none" })
    expect(press("ArrowRight", { shift: true })).toEqual({ type: "none" })
  })

  test("Up and Down outside the answers leave focus alone", () => {
    expect(press("ArrowDown", { zone: "other" })).toEqual({ type: "none" })
    expect(press("ArrowUp", { zone: "input" })).toEqual({ type: "none" })
  })

  test("Space acts on key down and ignores its repeats", () => {
    expect(press(" ")).toEqual({ type: "activate" })
    expect(press(" ", { zone: "custom" })).toEqual({ type: "activate" })
    expect(press(" ", { repeat: true })).toEqual({ type: "swallow" })
    expect(press(" ", { zone: "input" })).toEqual({ type: "none" })
    expect(press(" ", { zone: "other" })).toEqual({ type: "none" })
  })

  test("number keys pick answers in range, once per press", () => {
    expect(press("1")).toEqual({ type: "number", index: 0 })
    expect(press("3", { zone: "other" })).toEqual({ type: "number", index: 2 })
    expect(press("4")).toEqual({ type: "none" })
    expect(press("2", { repeat: true })).toEqual({ type: "none" })
    expect(press("2", { alt: true })).toEqual({ type: "none" })
    expect(press("2", { zone: "input" })).toEqual({ type: "none" })
  })

  test("the shortcuts work everywhere, including the text field", () => {
    expect(press("Escape", { zone: "input" })).toEqual({ type: "dismiss" })
    expect(press("[", { meta: true, zone: "input" })).toEqual({ type: "question", step: -1 })
    expect(press("ArrowLeft", { alt: true, mac: false })).toEqual({ type: "question", step: -1 })
    expect(press("Enter", { meta: true, zone: "input" })).toEqual({ type: "advance" })
    expect(press("Enter", { meta: true, repeat: true })).toEqual({ type: "none" })
  })

  test("Enter commits the highlighted answer once per press", () => {
    expect(press("Enter")).toEqual({ type: "commit" })
    expect(press("Enter", { zone: "custom" })).toEqual({ type: "commit" })
    expect(press("Enter", { repeat: true })).toEqual({ type: "swallow" })
    expect(press("Enter", { zone: "input" })).toEqual({ type: "none" })
    expect(press("Enter", { zone: "other" })).toEqual({ type: "none" })
  })

  test("Shift+Enter marks the highlighted answer without moving on", () => {
    expect(press("Enter", { shift: true })).toEqual({ type: "activate" })
    expect(press("Enter", { shift: true, zone: "custom" })).toEqual({ type: "activate" })
    expect(press("Enter", { shift: true, repeat: true })).toEqual({ type: "swallow" })
    expect(press("Enter", { shift: true, zone: "input" })).toEqual({ type: "none" })
  })

  test("with Cmd/Ctrl+Enter submitting, Enter marks the highlighted answer", () => {
    expect(press("Enter", { submit: "mod+enter" })).toEqual({ type: "activate" })
    expect(press("Enter", { submit: "mod+enter", shift: true })).toEqual({ type: "activate" })
    expect(press("Enter", { submit: "mod+enter", meta: true })).toEqual({ type: "advance" })
    expect(press("Enter", { submit: "mod+enter", zone: "input" })).toEqual({ type: "none" })
  })

  test("typing on the custom answer starts the answer", () => {
    expect(press("a", { zone: "custom" })).toEqual({ type: "type" })
    expect(press("A", { zone: "custom", shift: true })).toEqual({ type: "type" })
    expect(press("å", { zone: "custom", alt: true })).toEqual({ type: "type" })
    expect(press("0", { zone: "custom" })).toEqual({ type: "type" })
    expect(press("1", { zone: "custom" })).toEqual({ type: "number", index: 0 })
    expect(press("a", { zone: "custom", meta: true })).toEqual({ type: "none" })
    expect(press("a")).toEqual({ type: "none" })
    expect(press("Tab", { zone: "custom" })).toEqual({ type: "none" })
  })
})

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
