/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider, resolve, type Info, type Interface } from "../../../src/config"
import { CommandPaletteDialog } from "../../../src/component/command-palette"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { TestTuiContexts } from "../../fixture/tui-environment"

test("searches settings globally and opens the matching setting", async () => {
  let current: Info = {}
  const service: Interface = {
    get: async () => current,
    update: async (update) => {
      const draft = structuredClone(current)
      update(draft)
      current = draft
      return current
    },
  }

  function Fixture() {
    const dialog = useDialog()
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [
        {
          id: "session.new",
          title: "New session",
          group: "Session",
          palette: true,
          run() {},
        },
        {
          id: "model.list",
          title: "Switch model",
          group: "Agent",
          palette: true,
          run() {},
        },
      ],
    }))
    onMount(() => dialog.replace(() => <CommandPaletteDialog />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={resolve(current, { terminalSuspend: true })} service={service}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
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
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("New session"))
    expect(app.captureCharFrame()).not.toContain("Animations")
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)

    app.mockInput.pressArrow("down")
    for (const key of "sounds") app.mockInput.pressKey(key)
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Settings") && frame.includes("Sounds"))
    app.mockInput.pressEnter()
    await app.waitFor(() => current.attention?.sound === false)
  } finally {
    app.renderer.destroy()
  }
})
