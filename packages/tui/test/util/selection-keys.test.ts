import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable, InputRenderable, TextareaRenderable, TextRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import type { ClipboardService } from "../../src/context/clipboard"
import { Selection } from "../../src/util/selection"

async function setup(copyOnSelect = false) {
  const clock = new ManualClock()
  const app = await createTestRenderer({
    width: 24,
    height: 3,
    useThread: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    clock,
  })
  const writes: string[] = []
  const clipboard: ClipboardService = {
    read: async () => undefined,
    write: async (text) => {
      writes.push(text)
    },
  }
  app.renderer.keyInput.on("keypress", (event) =>
    Selection.handleSelectionKey(app.renderer, { show() {}, error() {} }, event, clipboard, copyOnSelect),
  )
  return { ...app, clock, writes }
}

async function terminal(copyOnSelect = false) {
  const app = await setup(copyOnSelect)
  const input: string[] = []
  const terminal = new EmbeddedTerminalRenderable(app.renderer, {
    width: 24,
    height: 3,
    onData(data, source) {
      if (source === "input") input.push(Buffer.from(data).toString())
    },
  })
  app.renderer.root.add(terminal)
  terminal.write("alpha beta gamma")
  terminal.focus()
  await app.renderOnce()
  return { ...app, terminal, input }
}

test("terminal selections retain repeated copies until Escape or typing dismisses them", async () => {
  const app = await terminal()
  try {
    await app.mockMouse.drag(6, 0, 9, 0)

    app.mockInput.pressCtrlC()
    app.mockInput.pressCtrlC()
    expect(app.writes).toEqual(["beta", "beta"])
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")
    expect(app.input).toEqual([])

    app.mockInput.pressEscape()
    app.clock.advance(20)
    expect(app.renderer.hasSelection).toBeFalse()
    expect(app.terminal.hasSelection()).toBeFalse()
    expect(app.input).toEqual([])

    app.mockInput.pressCtrlC()
    expect(app.input).toEqual(["\x03"])

    await app.mockMouse.drag(6, 0, 9, 0)
    app.mockInput.pressKey("x")
    expect(app.renderer.hasSelection).toBeFalse()
    expect(app.terminal.hasSelection()).toBeFalse()
    expect(app.input).toEqual(["\x03", "x"])

    app.mockInput.pressCtrlC()
    expect(app.input).toEqual(["\x03", "x", "\x03"])
    expect(app.writes).toEqual(["beta", "beta"])
  } finally {
    app.renderer.destroy()
  }
})

test("copy-on-select forwards Ctrl+C without recopying the selection", async () => {
  const app = await terminal(true)
  try {
    await app.mockMouse.drag(6, 0, 9, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")

    app.mockInput.pressCtrlC()
    expect(app.writes).toEqual([])
    expect(app.input).toEqual(["\x03"])
    expect(app.renderer.hasSelection).toBeFalse()
    expect(app.terminal.hasSelection()).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test.each(["click", "empty drag"])("a terminal %s does not consume Ctrl+C or Escape", async (gesture) => {
  const app = await terminal()
  const select = () => (gesture === "click" ? app.mockMouse.click(6, 0) : app.mockMouse.drag(18, 0, 21, 0))
  try {
    await select()
    app.mockInput.pressCtrlC()
    expect(app.renderer.hasSelection).toBeFalse()
    expect(app.input).toEqual(["\x03"])

    await select()
    app.mockInput.pressEscape()
    app.clock.advance(20)
    expect(app.renderer.hasSelection).toBeFalse()
    expect(app.input).toEqual(["\x03", "\x1b"])
    expect(app.writes).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test.each(["manual", "select"].flatMap((mode) => ["textarea", "input"].map((kind) => ({ mode, kind }))))(
  "$kind selections can be copied and edited in $mode mode",
  async (input) => {
    const app = await setup(input.mode === "select")
    const editor =
      input.kind === "input"
        ? new InputRenderable(app.renderer, { width: 24, value: "draft" })
        : new TextareaRenderable(app.renderer, { width: 24, height: 3, initialValue: "draft" })
    app.renderer.root.add(editor)
    editor.focus()
    try {
      await app.renderOnce()
      app.mockInput.pressKey("END")
      app.mockInput.pressArrow("left", { shift: true })

      app.mockInput.pressCtrlC()
      app.mockInput.pressKey("\x1b[1089::99;5u")
      expect(app.writes).toEqual(["t", "t"])
      expect(app.renderer.getSelection()?.getSelectedText()).toBe("t")
      expect(editor.plainText).toBe("draft")

      app.mockInput.pressArrow("left", { shift: true })
      expect(app.renderer.getSelection()?.getSelectedText()).toBe("ft")
      app.mockInput.pressKey("x")
      expect(editor.plainText).toBe("drax")
      expect(app.renderer.hasSelection).toBeFalse()
      expect(app.writes).toEqual(["t", "t"])
    } finally {
      app.renderer.destroy()
    }
  },
)

test("copy-on-select does not treat output selection as editor selection when an editor is focused", async () => {
  const app = await setup(true)
  const editor = new TextareaRenderable(app.renderer, { width: 24, height: 1, initialValue: "draft" })
  app.renderer.root.add(new TextRenderable(app.renderer, { width: 24, height: 1, content: "alpha beta gamma" }))
  app.renderer.root.add(editor)
  editor.focus()
  const forwarded: string[] = []
  app.renderer.keyInput.on("keypress", (event) => {
    if (!event.defaultPrevented) forwarded.push(event.name)
  })
  try {
    await app.renderOnce()
    await app.mockMouse.drag(6, 0, 9, 0)
    expect(app.renderer.currentFocusedEditor === editor).toBeTrue()
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")

    app.mockInput.pressCtrlC()
    expect(app.writes).toEqual([])
    expect(forwarded).toEqual(["c"])
    expect(app.renderer.hasSelection).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})
