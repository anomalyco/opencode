/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { DialogExportOptions } from "../../src/ui/dialog-export-options"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("tab and shift+tab move a visible focus through the export options", async () => {
  await using temporary = await tmpdir()
  let theme: ReturnType<ReturnType<typeof useTheme>["surface"]> | undefined
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  {(() => {
                    theme = useTheme().surface("dialog")
                    const dialog = useDialog()
                    onMount(() => dialog.replace(() => <DialogExportOptions defaultThinking={true} />))
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
  const span = (text: string) =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(text))
  const focusedButton = () => theme!.background.action.primary.focused
  const focusedField = () => theme!.text.formfield.focused
  const field = () => theme!.text.formfield.base

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Copy") && frame.includes("Include tools"))
    // Only the focused field is highlighted; checked fields keep the base label colour.
    expect(span("Markdown")?.fg.equals(focusedField())).toBe(true)
    expect(span("Include thinking")?.fg.equals(field())).toBe(true)
    expect(span("Copy")?.bg.equals(focusedButton())).toBe(false)

    for (const _ of [1, 2, 3, 4]) app.mockInput.pressTab()
    await app.waitForFrame(() => span("Copy")?.bg.equals(focusedButton()) === true)
    expect(span("Include tools")?.fg.equals(field())).toBe(true)

    app.mockInput.pressTab({ shift: true })
    await app.waitForFrame(() => span("Include tools")?.fg.equals(focusedField()) === true)
    expect(span("Copy")?.bg.equals(focusedButton())).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})
