/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { onMount } from "solid-js"
import { DialogOpen } from "../../../src/component/dialog-open"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("selecting an unhydrated session preserves its location", async () => {
  const state = mkdtempSync(path.join(tmpdir(), "opencode-dialog-open-"))
  const events = createEventStream()
  const remote = { directory: "/tmp/opencode/remote", workspaceID: "ws_remote" }
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session") return
    return json({
      data: [
        {
          id: "ses_remote",
          projectID: "proj_remote",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          title: "Remote session",
          location: remote,
        },
      ],
      cursor: {},
    })
  }, events)
  let route!: ReturnType<typeof useRoute>
  let location!: ReturnType<typeof useLocation>
  let data!: ReturnType<typeof useData>

  function Probe() {
    const dialog = useDialog()
    route = useRoute()
    location = useLocation()
    data = useData()
    onMount(() => dialog.replace(() => <DialogOpen />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig()}>
              <Keymap.Provider>
                <ToastProvider>
                  <RouteProvider>
                    <ClientProvider api={createApi(calls.fetch)}>
                      <DataProvider>
                        <LocationProvider>
                          <SessionTabsProvider>
                            <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                              <DialogProvider>
                                <Probe />
                              </DialogProvider>
                            </ThemeProvider>
                          </SessionTabsProvider>
                        </LocationProvider>
                      </DataProvider>
                    </ClientProvider>
                  </RouteProvider>
                </ToastProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()

  try {
    await app.waitForFrame((frame) => frame.includes("Remote session"))
    expect(data.session.get("ses_remote")).toBeUndefined()

    app.mockInput.pressEnter()
    await app.waitFor(() => route.data.type === "session")

    expect(route.data).toEqual({ type: "session", sessionID: "ses_remote" })
    expect(location.ref).toEqual(remote)
  } finally {
    app.renderer.destroy()
    rmSync(state, { recursive: true, force: true })
  }
})
