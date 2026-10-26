/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider, resolve, useConfig, type Info, type Interface } from "../src/config"
import { Keymap } from "../src/context/keymap"
import { ThemeProvider } from "../src/context/theme"
import { DialogProvider } from "../src/ui/dialog"
import { DialogPrompt } from "../src/ui/dialog-prompt"
import { ToastProvider } from "../src/ui/toast"
import { emptyThemeSource } from "./fixture/fixture"
import { TestTuiContexts } from "./fixture/tui-environment"

test("removing cursor config restores the default in a mounted dialog prompt", async () => {
  let current: Info = { cursor: { style: "underline", blinking: false } }
  const service: Interface = {
    get: async () => current,
    update: async (update) => {
      const draft = { ...current }
      update(draft)
      current = draft
      return draft
    },
  }
  const context = Promise.withResolvers<ReturnType<typeof useConfig>>()

  function Fixture() {
    context.resolve(useConfig())
    return <DialogPrompt title="Cursor reload" />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={resolve(current, { terminalSuspend: true })} service={service}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Fixture />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    const input = app.renderer.currentFocusedEditor
    if (!(input instanceof TextareaRenderable)) throw new Error("Dialog prompt input was not focused")
    expect(input.cursorStyle).toMatchObject({ style: "underline", blinking: false })

    const config = await context.promise
    await config.update((draft) => {
      delete draft.cursor
    })
    await app.renderOnce()

    expect(app.captureCharFrame()).toContain("Cursor reload")
    expect(app.renderer.currentFocusedEditor).toBe(input)
    expect(input.cursorStyle).toMatchObject({ style: "block", blinking: true })
  } finally {
    app.renderer.destroy()
  }
})
