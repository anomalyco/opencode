/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { SessionTabs, TabContextMenu, type SessionTabsController } from "../../src/component/session-tabs"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("clicking outside the tab context menu closes it", async () => {
  const [open, setOpen] = createSignal(true)
  const controller: SessionTabsController = {
    tabs: () => [{ sessionID: "session", title: "Session" }],
    current: () => "session",
    select: () => {},
    close: () => {},
    move: () => {},
    status: () => ({ unread: undefined, promptPulse: 0, attention: false, busy: false }),
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Show when={open()}>
                    <box position="absolute" left={10} top={5}>
                      <TabContextMenu
                        state={{ x: 20, y: 0, originX: 10, originY: 5, sessionID: "session" }}
                        tabs={controller}
                        onClose={() => setOpen(false)}
                      />
                    </box>
                  </Show>
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )

  try {
    await app.waitForFrame((frame) => frame.includes("Rename") && frame.includes("Close"))

    await app.mockMouse.click(40, 12)

    expect(app.captureCharFrame()).not.toContain("Rename")
  } finally {
    app.renderer.destroy()
  }
})

test("middle-clicking a tab closes it", async () => {
  let closed: string | undefined
  const controller: SessionTabsController = {
    tabs: () => [{ sessionID: "session", title: "Session" }],
    current: () => "session",
    select: () => {},
    close: (sessionID) => (closed = sessionID),
    move: () => {},
    status: () => ({ unread: undefined, promptPulse: 0, attention: false, busy: false }),
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <SessionTabs controller={controller} animations={false} />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
  )

  try {
    await app.waitForFrame((frame) => frame.includes("Session"))
    await app.mockMouse.click(20, 0, 1)
    await app.waitFor(() => closed === "session")
  } finally {
    app.renderer.destroy()
  }
})
