/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogExperiments } from "../../src/component/dialog-experiments"
import { ConfigProvider, type Info, type Interface } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { TuiAppProvider } from "../../src/context/runtime"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// [build channel, shown before, written by a toggle, shown after]
test.each([
  ["latest", "off", true, "on"],
  ["local", "on", false, "off"],
] as const)("rich media in a %s build shows %p and a toggle writes %p", async (channel, before, written, after) => {
  await using temporary = await tmpdir()
  const info: Info = {}
  const service: Interface = {
    get: async () => info,
    update: async (update) => {
      update(info)
      return info
    },
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel }}>
          <ConfigProvider config={createTuiResolvedConfig(info)} service={service}>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <Keymap.Provider>
                <ToastProvider>
                  <DialogProvider>
                    {(() => {
                      const dialog = useDialog()
                      onMount(() => dialog.replace(() => <DialogExperiments />))
                      return null
                    })()}
                  </DialogProvider>
                </ToastProvider>
              </Keymap.Provider>
            </ThemeProvider>
          </ConfigProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )
  const row = (frame: string) => frame.split("\n").find((line) => line.includes("Rich media")) ?? ""

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => row(frame).trimEnd().endsWith(before))
    // Rich media is the third entry.
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => row(frame).trimEnd().endsWith(after))
    expect(info.experimental?.rich_media).toBe(written)
  } finally {
    app.renderer.destroy()
  }
})
