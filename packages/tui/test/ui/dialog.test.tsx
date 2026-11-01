/** @jsxImportSource @opentui/solid */
import type { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, jest, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog, type DialogContext } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("clearing with no dialog open does not restore focus saved by an earlier dialog", async () => {
  await using temporary = await tmpdir()
  let dialog!: DialogContext
  let first!: InputRenderable
  let second!: InputRenderable
  function Capture() {
    dialog = useDialog()
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <Capture />
                  <input ref={(value) => (first = value)} />
                  <input ref={(value) => (second = value)} />
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )
  await app.renderOnce()

  // DialogProvider restores focus on a production setTimeout that cannot be injected.
  jest.useFakeTimers()
  try {
    first.focus()
    dialog.replace(() => <text>Dialog</text>)
    dialog.clear()
    jest.runOnlyPendingTimers()
    expect(first.focused).toBe(true)

    // Commands such as terminal.select clear dialogs and then move focus themselves.
    dialog.clear()
    second.focus()
    jest.runOnlyPendingTimers()
    expect(second.focused).toBe(true)
  } finally {
    jest.useRealTimers()
    app.renderer.destroy()
  }
})
