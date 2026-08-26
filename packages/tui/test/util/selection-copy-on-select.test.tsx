/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
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
