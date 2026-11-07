/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogThemeList } from "../../src/component/dialog-theme-list"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider, useThemes } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("moving or filtering the theme list only highlights; the theme changes on confirm", async () => {
  await using temporary = await tmpdir()
  let themes!: ReturnType<typeof useThemes>
  let open!: () => void
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  {(() => {
                    themes = useThemes()
                    const dialog = useDialog()
                    open = () => dialog.replace(() => <DialogThemeList />)
                    onMount(open)
                    return null
                  })()}
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Themes"))
    const initial = themes.selected

    // Moving the cursor previews nothing: the theme only changes when a row is confirmed.
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("Themes"))
    expect(themes.selected).toBe(initial)

    // Filtering is navigation too, so typing a query must not apply a theme.
    app.mockInput.pressKey("o")
    await app.waitForFrame((frame) => frame.includes("Themes"))
    expect(themes.selected).toBe(initial)

    // Cancelling leaves the theme alone because nothing was applied to roll back.
    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => !frame.includes("Themes"))
    expect(themes.selected).toBe(initial)

    // Confirming still applies the highlighted theme.
    open()
    await app.waitForFrame((frame) => frame.includes("Themes"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => !frame.includes("Themes"))
    expect(themes.selected).not.toBe(initial)
  } finally {
    app.renderer.destroy()
  }
})
