import { describe, expect, test } from "bun:test"
import { applySlashCommandSelection, browserSlashSelection, parseBrowserSlashCommand } from "./browser-command"

describe("browser slash command helpers", () => {
  test("parses bare /browser without a URL", () => {
    expect(parseBrowserSlashCommand("/browser")).toEqual({ ok: true })
  })

  test("parses /browser domain-looking text as context task instead of URL-only command", () => {
    expect(parseBrowserSlashCommand("/browser facebook.com")).toEqual({ ok: true, task: "facebook.com" })
  })

  test("parses /browser prose as context task", () => {
    expect(parseBrowserSlashCommand("/browser investigá facebook")).toEqual({ ok: true, task: "investigá facebook" })
  })

  test("parses /browser URL-looking prose as context task", () => {
    expect(parseBrowserSlashCommand("/browser abrir facebook.com y revisar login")).toEqual({
      ok: true,
      task: "abrir facebook.com y revisar login",
    })
  })

  test("picker-selected /browser inserts literal command text for optional URL entry", () => {
    expect(
      browserSlashSelection([
        { type: "image", id: "image-1", dataUrl: "data:image/png;base64,AAA", mime: "image/png", filename: "shot.png" },
      ]),
    ).toEqual({
      text: "/browser ",
      cursor: 9,
      prompt: [
        { type: "text", content: "/browser ", start: 0, end: 9 },
        { type: "image", id: "image-1", dataUrl: "data:image/png;base64,AAA", mime: "image/png", filename: "shot.png" },
      ],
    })
  })

  test("slash picker selection inserts /browser instead of dispatching the browser command", () => {
    const editorText: string[] = []
    const promptValues: unknown[] = []
    const cursorValues: number[] = []
    const focused: boolean[] = []
    const triggered: string[] = []
    const cleared: boolean[] = []

    applySlashCommandSelection({
      cmd: {
        id: "browser.open",
        trigger: "browser",
        title: "Browser",
        description: "Control the in-app browser",
        type: "builtin",
      },
      images: [{ type: "image", id: "image-1", dataUrl: "data:image/png;base64,AAA", mime: "image/png", filename: "shot.png" }],
      setEditorText: (value) => editorText.push(value),
      setPrompt: (value, cursor) => {
        promptValues.push(value)
        cursorValues.push(cursor)
      },
      focusEditorEnd: () => focused.push(true),
      clearEditor: () => cleared.push(true),
      triggerCommand: (id) => triggered.push(id),
    })

    expect(editorText).toEqual(["/browser "])
    expect(promptValues).toEqual([
      [
        { type: "text", content: "/browser ", start: 0, end: 9 },
        { type: "image", id: "image-1", dataUrl: "data:image/png;base64,AAA", mime: "image/png", filename: "shot.png" },
      ],
    ])
    expect(cursorValues).toEqual([9])
    expect(focused).toEqual([true])
    expect(triggered).toEqual([])
    expect(cleared).toEqual([])
  })

  test("slash picker selection still dispatches non-browser builtin commands", () => {
    const promptValues: unknown[] = []
    const triggered: Array<{ id: string; source?: string }> = []
    const cleared: boolean[] = []

    applySlashCommandSelection({
      cmd: { id: "session.compact", trigger: "compact", title: "Compact", type: "builtin" },
      images: [],
      setEditorText: () => undefined,
      setPrompt: (value, cursor) => promptValues.push({ value, cursor }),
      focusEditorEnd: () => undefined,
      clearEditor: () => cleared.push(true),
      triggerCommand: (id, source) => triggered.push({ id, source }),
    })

    expect(cleared).toEqual([true])
    expect(promptValues).toEqual([{ value: [{ type: "text", content: "", start: 0, end: 0 }], cursor: 0 }])
    expect(triggered).toEqual([{ id: "session.compact", source: "slash" }])
  })

  test("slash picker selection keeps custom commands as editable slash text", () => {
    const editorText: string[] = []
    const promptValues: unknown[] = []
    const focused: boolean[] = []
    const triggered: string[] = []

    applySlashCommandSelection({
      cmd: { id: "custom.deploy", trigger: "deploy", title: "deploy", type: "custom", source: "command" },
      images: [],
      setEditorText: (value) => editorText.push(value),
      setPrompt: (value, cursor) => promptValues.push({ value, cursor }),
      focusEditorEnd: () => focused.push(true),
      clearEditor: () => undefined,
      triggerCommand: (id) => triggered.push(id),
    })

    expect(editorText).toEqual(["/deploy "])
    expect(promptValues).toEqual([{ value: [{ type: "text", content: "/deploy ", start: 0, end: 8 }], cursor: 8 }])
    expect(focused).toEqual([true])
    expect(triggered).toEqual([])
  })
})
