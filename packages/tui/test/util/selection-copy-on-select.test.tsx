/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ManualClock } from "@opentui/core/testing"
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

test.each([
  { column: 6, word: "beta" },
  { column: 17, word: "" },
])("copy-on-select preserves multi-clicks at column $column", async (input) => {
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
    { width: 20, height: 2, clock: new ManualClock() },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("beta"))

    await app.mockMouse.click(input.column, 0)
    expect(app.renderer.getSelection()?.getSelectedText() ?? "").toBe("")
    expect(writes).toEqual([])

    await app.mockMouse.click(input.column, 0)
    expect(app.renderer.getSelection()?.getSelectedText() ?? "").toBe(input.word)
    expect(writes).toEqual(input.word ? [input.word] : [])

    await app.mockMouse.click(input.column, 0)
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("alpha beta gamma")
    expect(writes).toEqual([...(input.word ? [input.word] : []), "alpha beta gamma"])
  } finally {
    app.renderer.destroy()
  }
})
