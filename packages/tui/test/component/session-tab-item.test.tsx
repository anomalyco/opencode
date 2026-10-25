/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { MouseButton } from "@opentui/core"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider, type Info } from "../../src/config"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabItem,
  type SessionTabsController,
  type SessionTabsStatus,
} from "../../src/component/session-tabs"
import { SPINNER_FRAMES } from "../../src/component/spinner-frames"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { Keymap } from "../../src/context/keymap"
import { RouteProvider } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider } from "../../src/context/session-tabs"
import { StorageProvider } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("a plugin tab item shows the host status or its own label, and selects and closes its tab", async () => {
  await using temporary = await tmpdir()
  const [status, setStatus] = createSignal<SessionTabsStatus>(EMPTY_SESSION_TAB_STATUS)
  const [label, setLabel] = createSignal<string>()
  const [active, setActive] = createSignal("first")
  const closed: string[] = []
  const settings: Info = { tabs: { mode: "on" }, animations: false }
  const controller = {
    tabs: () => [
      { sessionID: "first", title: "First" },
      { sessionID: "second", title: "Second" },
    ],
    current: active,
    select: setActive,
    close: (sessionID?: string) => void closed.push(sessionID ?? ""),
    move() {},
    status: (sessionID: string) => (sessionID === "second" ? status() : EMPTY_SESSION_TAB_STATUS),
  } satisfies SessionTabsController
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider
              config={createTuiResolvedConfig(settings)}
              service={{ get: async () => settings, update: async () => settings }}
            >
              <RouteProvider initialRoute={{ type: "home" }}>
                <ClientProvider api={createApi(createFetch(undefined, createEventStream()).fetch)}>
                  <DataProvider directory={temporary.path}>
                    <LocationProvider>
                      <SessionTabsProvider>
                        <ThemeProvider mode="dark" source={emptyThemeSource}>
                          <Keymap.Provider>
                            <ToastProvider>
                              <DialogProvider>
                                <box flexDirection="row">
                                  <text>{"[plugin] "}</text>
                                  <SessionTabItem
                                    controller={controller}
                                    sessionID="second"
                                    width={16}
                                    label={label()}
                                  />
                                </box>
                              </DialogProvider>
                            </ToastProvider>
                          </Keymap.Provider>
                        </ThemeProvider>
                      </SessionTabsProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </RouteProvider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 3 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("[plugin]") && frame.includes("Second"))

    setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true })
    await app.waitForFrame((frame) => frame.includes(`${SPINNER_FRAMES[0]} Second`))

    // A plugin label takes the marker's place even while the tab is busy.
    setLabel("k")
    await app.waitForFrame((frame) => frame.includes(" k Second"))

    const column = app.captureCharFrame().split("\n")[0]!.indexOf("Second")
    await app.mockMouse.click(column, 0)
    expect(active()).toBe("second")

    await app.mockMouse.click(column, 0, MouseButton.MIDDLE)
    expect(closed).toEqual(["second"])
  } finally {
    app.renderer.destroy()
  }
})
