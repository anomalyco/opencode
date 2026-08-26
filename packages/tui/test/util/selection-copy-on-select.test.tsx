/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { useClipboard } from "../../src/context/clipboard"
import { copyOnSelectRelease } from "../../src/util/selection"
import { TestTuiContexts } from "../fixture/tui-environment"

function CopyOnSelectText() {
  const renderer = useRenderer()
  const clipboard = useClipboard()
  const toast = {
    show: () => {},
    error: () => {},
  }
  return (
    <box onMouseUp={(event) => copyOnSelectRelease(event, renderer, toast, clipboard)}>
      <text>alpha beta gamma</text>
    </box>
  )
}

test("copy-on-select keeps a word highlight so a third click can select the line", async () => {
  const writes: string[] = []
  const app = await testRender(
    () => (
      <TestTuiContexts
        clipboard={{
          async read() {
            return undefined
          },
          async write(text) {
            writes.push(text)
          },
        }}
      >
        <CopyOnSelectText />
      </TestTuiContexts>
    ),
    { width: 20, height: 2 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("beta"))

    await app.mockMouse.click(6, 0)
    expect(app.renderer.getSelection()?.getSelectedText() ?? "").toBe("")
    expect(writes).toEqual([])

    await app.mockMouse.click(6, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta")
    expect(writes).toEqual(["beta"])

    await app.mockMouse.click(6, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("alpha beta gamma")
    expect(writes).toEqual(["beta", "alpha beta gamma"])
  } finally {
    app.renderer.destroy()
  }
})

test("terminal copy-on-select ignores clicks and empty drags but preserves a copied drag", async () => {
  const writes: string[] = []
  const app = await createTestRenderer({ width: 20, height: 2, clock: new ManualClock() })
  const clipboard = {
    async read() {
      return undefined
    },
    async write(text: string) {
      writes.push(text)
    },
  }
  const toast = { show: () => {}, error: () => {} }
  const box = new BoxRenderable(app.renderer, {
    onMouseUp: (event) => copyOnSelectRelease(event, app.renderer, toast, clipboard),
  })
  const terminal = new EmbeddedTerminalRenderable(app.renderer, { cols: 20, rows: 2 })
  box.add(terminal)
  app.renderer.root.add(box)

  try {
    terminal.write(Buffer.from("alpha beta gamma"))
    await app.renderOnce()

    await app.mockMouse.pressDown(6, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("b")
    await app.mockMouse.release(6, 0)
    expect(writes).toEqual([])

    await app.mockMouse.drag(0, 0, 4, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("alpha")
    expect(writes).toEqual(["alpha"])

    await app.mockMouse.drag(16, 0, 19, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("")
    expect(writes).toEqual(["alpha"])
  } finally {
    app.renderer.destroy()
  }
})
