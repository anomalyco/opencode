/** @jsxImportSource @opentui/solid */
import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onMount } from "solid-js"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

for (const width of [40, 100]) {
  test(`notification history can search message bodies, inspect and clear at width ${width}`, async () => {
    await using temporary = await tmpdir()
    const root = temporary.path
    const state = path.join(root, "state")
    await mkdir(state, { recursive: true })
    const [
      { ConfigProvider },
      { ThemeProvider },
      { Keymap },
      { DialogProvider, useDialog },
      { DialogToastHistory },
      { ToastProvider, useToast },
    ] = await Promise.all([
      import("../../../src/config"),
      import("../../../src/context/theme"),
      import("../../../src/context/keymap"),
      import("../../../src/ui/dialog"),
      import("../../../src/ui/dialog-toast-history"),
      import("../../../src/ui/toast"),
    ])
    function Open() {
      const toast = useToast()
      const dialog = useDialog()
      onMount(() => {
        toast.show({ title: "Plugin warning", message: "First line\nUnique detail", variant: "warning" })
        toast.dismiss()
        toast.show({ title: "Copied", message: "Some other notification", variant: "success" })
        toast.dismiss()
        dialog.replace(() => <DialogToastHistory />)
      })
      return null
    }
    const app = await testRender(
      () => (
        <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
          <ConfigProvider config={createTuiResolvedConfig()}>
            <Keymap.Provider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
                <ToastProvider>
                  <DialogProvider>
                    <Open />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width, height: 24, kittyKeyboard: true },
    )
    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("Plugin warning") && frame.includes("Copied"))
      await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
      await app.mockInput.typeText("Unique detail")
      await app.waitForFrame((frame) => frame.includes("Plugin warning") && !frame.includes("Copied"))
      app.mockInput.pressKey("RETURN")
      await app.waitForFrame(
        (frame) => frame.includes("First line") && frame.includes("Unique detail") && frame.includes("enter back"),
      )
      app.mockInput.pressKey("RETURN")
      await app.waitForFrame((frame) => frame.includes("Notification history") && frame.includes("Copied"))
      app.mockInput.pressKey("x", { ctrl: true })
      await app.waitForFrame((frame) => frame.includes("No notifications yet"))
      expect(app.captureCharFrame()).not.toContain("Plugin warning")
      app.mockInput.pressKey("ESCAPE")
      await app.waitForFrame((frame) => !frame.includes("Notification history"))
    } finally {
      app.renderer.destroy()
    }
  })
}
