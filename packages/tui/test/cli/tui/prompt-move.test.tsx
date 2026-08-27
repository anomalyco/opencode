/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { usePromptMove } from "../../../src/component/prompt/move"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json, type FetchHandler } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("selecting an existing worktree updates the new session location immediately", async () => {
  const destination = "/tmp/opencode-existing-worktree"
  const events = createEventStream()
  const requests: { path: string; method: string }[] = []
  const handler: FetchHandler = (url, request) => {
    requests.push({ path: url.pathname, method: request.method })
    if (url.pathname === "/api/worktree/proj_test" && request.method === "GET") {
      return json([{ directory: destination, strategy: "git" }])
    }
    if (url.pathname === "/api/location") {
      return json({
        directory: destination,
        project: { id: "proj_test", directory: destination, canonical: destination },
      })
    }
  }
  const calls = createFetch(handler, events)
  let open!: () => Promise<void>
  let location!: ReturnType<typeof useLocation>

  function Probe() {
    location = useLocation()
    open = usePromptMove({ projectID: () => "proj_test", sessionID: () => undefined }).open
    return <text>{location.ref?.directory ?? "no destination"}</text>
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider>
                    <LocationProvider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <DialogProvider>
                          <Probe />
                        </DialogProvider>
                      </ThemeProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </RouteProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()

  try {
    await app.waitFor(() => typeof open === "function")
    await open()
    await app.waitForFrame((frame) => frame.includes(destination))
    app.mockInput.pressEnter()
    await app.waitFor(() => location.ref?.directory === destination)
    await app.waitForFrame((frame) => frame.includes(destination))
    expect(requests.some((request) => request.path === "/api/session" && request.method === "POST")).toBeFalse()
  } finally {
    app.renderer.destroy()
    events.disconnect()
  }
})
