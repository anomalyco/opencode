/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogBleed, DialogHeader, DialogLayout, DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test.each([
  [undefined, 1],
  [0, 0],
  [2, 2],
])("footerGap %p leaves %p blank rows between the body and the footer", async (footerGap, blank) => {
  await using temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig({ experimental: { "new-designs": true } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <DialogLayout
                    header={<DialogHeader title="Title" />}
                    footer={{ actions: { primary: [{ title: "copy", key: "c" }] } }}
                    footerGap={footerGap}
                  >
                    <DialogBleed>
                      <text>BODY</text>
                    </DialogBleed>
                  </DialogLayout>
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 16 },
  )
  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("BODY") && frame.includes("copy c"))
    const lines = app.captureCharFrame().split("\n")
    const body = lines.findIndex((line) => line.includes("BODY"))
    const footer = lines.findIndex((line) => line.includes("copy c"))
    // The footer band has one row of top padding.
    expect(footer - body - 2).toBe(blank)
  } finally {
    app.renderer.destroy()
  }
})
