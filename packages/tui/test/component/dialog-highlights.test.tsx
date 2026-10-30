/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogHighlights } from "../../src/component/dialog-highlights"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
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
function Open() {
  const dialog = useDialog()
  onMount(() => dialog.replace(() => <DialogHighlights version="2.0.27" items={items} />))
  return null
}

test("scrolls long highlights between a fixed title and footer", async () => {
  await using temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <Open />
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 70, height: 20, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("What's new in 2.0.27") && frame.includes("Highlight 1"))
    const top = app.captureCharFrame()
    expect(top).toContain("command-1")
    expect(top).toContain("scroll ↑/↓")
    expect(top).not.toContain("Highlight 5")
    expect(top).not.toContain("`")

    app.mockInput.pressKey("END")
    await app.waitForFrame((frame) => frame.includes("Highlight 5"))
    const bottom = app.captureCharFrame()
    expect(bottom).toContain("What's new in 2.0.27")
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
