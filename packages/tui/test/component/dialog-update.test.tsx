/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, onCleanup } from "solid-js"
import { DialogUpdate } from "../../src/component/dialog-update"
import { ConfigProvider } from "../../src/config"
import type { UpdateState } from "../../src/context/update-notification"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("installation progress replaces checking while the update job is still pending", async () => {
  await using temporary = await tmpdir()
  const [state, setState] = createSignal<UpdateState>()
  const pending = Promise.withResolvers<string | undefined>()
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <DialogUpdate
                    check={() => pending.promise}
                    state={state}
                    skip={() => {}}
                    install={() => Promise.resolve()}
                    restart={() => {}}
                  />
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
    await app.waitForFrame((frame) => frame.includes("Checking for updates"))
    setState({ type: "installing", version: "2.0.0" })
    await app.waitForFrame(
      (frame) =>
        frame.includes("Updating OpenCode") &&
        frame.includes("Installing OpenCode 2.0.0") &&
        !frame.includes("Checking"),
    )
    expect(app.captureCharFrame()).not.toContain("Skip")
    pending.reject(new Error("Update service unavailable"))
    await app.waitForFrame((frame) => frame.includes("Update service unavailable") && !frame.includes("Installing"))
  } finally {
    pending.resolve(undefined)
    app.renderer.destroy()
  }
})

test.each([false, true])("update choices are keyboard-navigable buttons with new designs %p", async (newDesigns) => {
  await using temporary = await tmpdir()
  const [state] = createSignal<UpdateState>({ type: "available", version: "2.0.0" } as UpdateState)
  const ran: string[] = []
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig({ experimental: { "new-designs": newDesigns } })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <ModalUpdate
                    state={state}
                    skip={() => ran.push("skip")}
                    install={async () => void ran.push("install")}
                    restart={() => {}}
                  />
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
    await app.waitForFrame((frame) => frame.includes("Update available") && frame.includes("Skip"))
    const frame = app.captureCharFrame()
    expect(frame).toMatch(/Skip\s+Update/)
    expect(frame).not.toContain("enter")

    app.mockInput.pressArrow("left")
    app.mockInput.pressEnter()
    await app.waitFor(() => ran.length > 0)
    expect(ran).toEqual(["skip"])
  } finally {
    app.renderer.destroy()
  }
})

function ModalUpdate(props: Parameters<typeof DialogUpdate>[0]) {
  onCleanup(Keymap.use().mode.push("modal"))
  return <DialogUpdate {...props} />
}
