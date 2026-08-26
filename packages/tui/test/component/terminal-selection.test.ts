import { BoxRenderable, EmbeddedTerminalRenderable, MouseButton } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { expect, test } from "bun:test"
import { copy, copyOnSelectRelease } from "../../src/util/selection"

async function setup(mode: "select" | "manual") {
  const app = await createTestRenderer({ width: 20, height: 3 })
  const writes: string[] = []
  const input: string[] = []
  const toast = { show() {}, error() {} }
  const clipboard = {
    read: async () => undefined,
    write: async (text: string) => {
      writes.push(text)
    },
  }
  const box = new BoxRenderable(app.renderer, {
    width: 20,
    height: 3,
    onMouseDown: (event) => {
      if (mode !== "manual" || event.button !== 2) return
      if (!copy(app.renderer, toast, clipboard)) return
      event.preventDefault()
      event.stopPropagation()
    },
    onMouseUp: (event) => (mode === "select" ? copyOnSelectRelease(event, app.renderer, toast, clipboard) : undefined),
  })
  const terminal = new EmbeddedTerminalRenderable(app.renderer, {
    width: 20,
    height: 3,
    onData: (data, source) => {
      if (source === "input") input.push(new TextDecoder().decode(data))
    },
  })
  box.add(terminal)
  app.renderer.root.add(box)
  terminal.write("alpha beta gamma")
  return { ...app, terminal, writes, input }
}

test.each(["select", "manual"] as const)(
  "%s copy ignores a terminal click, and typing and ctrl+c reach the terminal",
  async (mode) => {
    const app = await setup(mode)
    try {
      await app.renderOnce()
      await app.mockMouse.click(6, 0)
      if (mode === "manual") await app.mockMouse.click(6, 0, MouseButton.RIGHT)
      expect(app.terminal.focused).toBeTrue()
      expect(app.terminal.hasSelection()).toBeFalse()
      expect(app.terminal.getSelectedText()).toBe("")
      expect(app.writes).toEqual([])

      app.mockInput.pressKey("x")
      app.mockInput.pressKey("c", { ctrl: true })
      await app.renderOnce()
      expect(app.input).toEqual(["x", "\x03"])
      expect(app.terminal.hasSelection()).toBeFalse()
      expect(app.writes).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  },
)

test.each(["select", "manual"] as const)("%s copy keeps a dragged terminal selection", async (mode) => {
  const app = await setup(mode)
  try {
    await app.renderOnce()
    await app.mockMouse.drag(6, 0, 9, 0)
    if (mode === "manual") {
      expect(app.writes).toEqual([])
      await app.mockMouse.click(9, 0, MouseButton.RIGHT)
    }
    expect(app.terminal.getSelectedText()).toBe("beta")
    expect(app.writes).toEqual(["beta"])
  } finally {
    app.renderer.destroy()
  }
})
