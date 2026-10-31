/** @jsxImportSource @opentui/solid */
import type { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
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
  let dialog: DialogContext | undefined
  let first: InputRenderable | undefined
  let second: InputRenderable | undefined
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  {(() => {
                    dialog = useDialog()
                    return null
                  })()}
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

  try {
    app.renderer.start()
    await app.waitForFrame(() => first !== undefined && second !== undefined)
    first!.focus()
    dialog!.replace(() => <text>Dialog</text>)
    expect(first!.focused).toBe(false)
    dialog!.clear()
    await Bun.sleep(20)
    expect(first!.focused).toBe(true)

    // Commands such as terminal.select clear dialogs and then move focus themselves.
    dialog!.clear()
    second!.focus()
    await Bun.sleep(20)
    expect(second!.focused).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
