/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { Answer } from "../../src/feature-plugins/prompt/btw"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("btw answer dialog renders outside PluginProvider", async () => {
  function OpenAnswer() {
    const dialog = useDialog()
    onCleanup(Keymap.use().mode.push("modal"))
    onMount(() => {
      dialog.replace(() => (
        <Answer question="What is OpenCode?" answer="A coding agent." markdown={() => undefined} />
      ))
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <OpenAnswer />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()

  try {
    await app.waitForFrame(
      (frame) => frame.includes("/btw") && frame.includes("What is OpenCode?") && frame.includes("A coding agent."),
    )
    expect(app.captureCharFrame()).toContain("copy")
  } finally {
    app.renderer.destroy()
  }
})
