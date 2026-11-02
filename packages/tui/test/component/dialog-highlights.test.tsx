/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogHighlights } from "../../src/component/dialog-highlights"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import type { TuiReleaseHighlights } from "../../src/context/runtime"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const items = Array.from({ length: 5 }, (_, index) => ({
  title: `Highlight ${index + 1}`,
  body: `Use \`command-${index + 1}\` to try the change. It explains what you can do now and why it matters to you.`,
}))

// Dialog key bindings are only active while the dialog is on the stack.
function Open(props: { releases: ReadonlyArray<TuiReleaseHighlights> }) {
  const dialog = useDialog()
  onMount(() => dialog.replace(() => <DialogHighlights releases={props.releases} />))
  return null
}

function render(directory: string, releases: ReadonlyArray<TuiReleaseHighlights>) {
  return testRender(
    () => (
      <TestTuiContexts directory={directory} paths={{ state: directory }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <Open releases={releases} />
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 70, height: 20, kittyKeyboard: true },
  )
}

test("scrolls long highlights between a fixed title and footer", async () => {
  await using temporary = await tmpdir()
  const app = await render(temporary.path, [{ version: "2.0.27", items }])

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("What's new") && frame.includes("Highlight 1"))
    const top = app.captureCharFrame()
    expect(top).toContain("2.0.27")
    expect(top).toContain("command-1")
    expect(top).toContain("scroll ↑/↓")
    expect(top).not.toContain("Highlight 5")
    expect(top).not.toContain("`")

    app.mockInput.pressKey("END")
    await app.waitForFrame((frame) => frame.includes("Highlight 5"))
    const bottom = app.captureCharFrame()
    expect(bottom).toContain("What's new")
    expect(bottom).toContain("scroll ↑/↓")
    expect(bottom).not.toContain("Highlight 1")

    app.mockInput.pressKey("k")
    app.mockInput.pressKey("HOME")
    await app.waitForFrame((frame) => frame.includes("Highlight 1"))

    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => !frame.includes("What's new"))
  } finally {
    app.renderer.destroy()
  }
})

test("switches releases with the arrow buttons, starting at the newest", async () => {
  await using temporary = await tmpdir()
  const app = await render(temporary.path, [
    { version: "2.0.29", items },
    { version: "2.0.28", items: [{ title: "Middle highlight", body: "From the middle release." }] },
    { version: "2.0.27", items: [{ title: "Oldest highlight", body: "From the oldest release." }] },
  ])
  const click = (label: string) => {
    const rows = app.captureCharFrame().split("\n")
    const y = rows.findIndex((row) => row.includes(label))
    return app.mockMouse.click(rows[y].indexOf(label) + 1, y)
  }

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("2.0.29") && frame.includes("Highlight 1"))
    // The newest release is first, so only the older-release arrow applies.
    expect(app.captureCharFrame()).toContain("2.0.29   >")
    expect(app.captureCharFrame()).not.toContain("<")

    // Switching releases scrolls back to the top.
    app.mockInput.pressKey("END")
    await app.waitForFrame((frame) => frame.includes("Highlight 5"))
    await click(">")
    await app.waitForFrame((frame) => frame.includes("2.0.28") && frame.includes("Middle highlight"))
    expect(app.captureCharFrame()).toContain("<   2.0.28   >")

    app.mockInput.pressArrow("right")
    await app.waitForFrame((frame) => frame.includes("2.0.27") && frame.includes("Oldest highlight"))
    expect(app.captureCharFrame()).not.toContain(">")

    await click("<")
    await app.waitForFrame((frame) => frame.includes("Middle highlight"))
    app.mockInput.pressKey("h")
    await app.waitForFrame((frame) => frame.includes("2.0.29") && frame.includes("Highlight 1"))
    expect(app.captureCharFrame()).not.toContain("Highlight 5")

    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => !frame.includes("What's new"))
  } finally {
    app.renderer.destroy()
  }
})
