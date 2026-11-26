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
import { emptyThemeSource } from "../../fixture/fixture"

test("searches settings globally and opens the matching setting", async () => {
  let current: Info = { experimental: { "new-designs": false } }
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
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("New session"))
    expect(app.captureCharFrame()).not.toContain("Animations")
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)

    app.mockInput.pressArrow("down")
    for (const key of "image preview") app.mockInput.pressKey(key)
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Settings") && frame.includes("Image previews"))
    app.mockInput.pressEnter()
    await app.waitFor(() => current.prompt?.image_preview === true)
  } finally {
    app.renderer.destroy()
  }
})

test("includes active-mode palette commands while excluding disabled and inactive modes", async () => {
  const calls: string[] = []
  let keymap!: Keymap
  let dialog!: ReturnType<typeof useDialog>

  function Fixture() {
    keymap = Keymap.use()
    dialog = useDialog()
    Keymap.createLayer(() => ({
      commands: [
        {
          id: "plugin.report",
          title: "Plugin report",
          group: "Plugin",
          bind: "r",
          palette: true,
          run: () => void calls.push("plugin.report"),
        },
      ],
    }))
    Keymap.createLayer(() => ({
      enabled: false,
      commands: [
        {
          id: "plugin.disabled",
          title: "Disabled plugin command",
          palette: true,
          run: () => void calls.push("plugin.disabled"),
        },
      ],
    }))
    Keymap.createLayer(() => ({
      mode: "custom",
      commands: [
        {
          id: "plugin.custom",
          title: "Custom mode command",
          palette: true,
          run: () => void calls.push("plugin.custom"),
        },
      ],
    }))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={resolve({}, { terminalSuspend: true })}>
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
  app.renderer.start()

  try {
    await app.waitFor(() => Boolean(dialog))
    dialog.replace(() => <CommandPaletteDialog />)
    await app.waitForFrame((frame) => frame.includes("Plugin report"))
    expect(app.captureCharFrame()).not.toContain("Disabled plugin command")
    expect(app.captureCharFrame()).not.toContain("Custom mode command")
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)

    await app.mockInput.typeText("report")
    expect(calls).toEqual([])
    app.mockInput.pressEnter()
    await app.waitFor(() => calls.length === 1)
    expect(calls).toEqual(["plugin.report"])

    const popCustom = keymap.mode.push("custom")
    dialog.replace(() => <CommandPaletteDialog />)
    await app.waitForFrame((frame) => frame.includes("Custom mode command"))
    expect(app.captureCharFrame()).not.toContain("Plugin report")
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.mockInput.typeText("custom")
    app.mockInput.pressEnter()
    await app.waitFor(() => calls.length === 2)
    expect(calls).toEqual(["plugin.report", "plugin.custom"])
    popCustom()
  } finally {
    app.renderer.destroy()
  }
})
