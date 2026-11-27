/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { DialogSessionList } from "../../../src/component/dialog-session-list"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { RouteProvider } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, directory, json, type FetchHandler } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

function session(id: string, title: string, updated: number) {
  return {
    id,
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated, updated },
    title,
    location: { directory },
  }
}

async function renderSessionList(sessions: ReturnType<typeof session>[], handler?: FetchHandler) {
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    const handled = await handler?.(url, request)
    if (handled) return handled
    if (url.pathname !== "/api/session") return undefined
    const parentID = url.searchParams.get("parentID")
    if (parentID && parentID !== "null") return json({ data: [], cursor: {} })
    return json({ data: sessions, cursor: {} })
  }, events)
  const temporary = await tmpdir()
  let storage!: ReturnType<typeof useStorage>
  let local!: ReturnType<typeof useLocal>

  function Probe() {
    const dialog = useDialog()
    storage = useStorage()
    local = useLocal()
    onMount(() => dialog.replace(() => <DialogSessionList />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path, home: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "off" } })}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={directory}>
                            <LocationProvider>
                              <SessionTabsProvider>
                                <ThemeProvider mode="dark" source={emptyThemeSource}>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <Probe />
                                    </DialogProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SessionTabsProvider>
                            </LocationProvider>
                          </DataProvider>
                        </PermissionProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </Keymap.Provider>
              </ConfigProvider>
            </ArgsProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()

  return {
    app,
    get local() {
      return local
    },
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await storage.flush()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("pin toggle keeps the cursor on the toggled session", async () => {
  const now = Date.now()
  await using setup = await renderSessionList(
    ["E", "D", "C", "B", "A"].map((name, index) => session(`ses_${name}`, `session-${name}`, now - index * 1000)),
  )
  await setup.app.waitForFrame((frame) => frame.includes("session-A"))

  for (const _ of [1, 2, 3]) setup.app.mockInput.pressArrow("down")
  setup.app.mockInput.pressKey("f", { ctrl: true })
  await setup.app.waitForFrame((frame) => frame.includes("Pinned"))
  expect(setup.local.session.pinned()).toEqual(["ses_B"])

  setup.app.mockInput.pressKey("f", { ctrl: true })
  await setup.app.waitForFrame((frame) => !frame.includes("Pinned"))
  expect(setup.local.session.pinned()).toEqual([])
})

test("rename after arming delete prefills the session title", async () => {
  const renamed = Promise.withResolvers<unknown>()
  await using setup = await renderSessionList(
    [session("ses_disposable", "Disposable session", Date.now())],
    async (url, request) => {
      if (url.pathname !== "/api/session/ses_disposable" || request.method === "GET") return undefined
      renamed.resolve(await request.json())
      return json(session("ses_disposable", "Disposable session", Date.now()))
    },
  )
  await setup.app.waitForFrame((frame) => frame.includes("Disposable session"))

  setup.app.mockInput.pressKey("d", { ctrl: true })
  await setup.app.waitForFrame((frame) => frame.includes("again to confirm"))
  setup.app.mockInput.pressKey("r", { ctrl: true })
  const frame = await setup.app.waitForFrame(
    (frame) =>
      frame.includes("Rename session") && setup.app.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  expect(frame).toContain("Disposable session")
  expect(frame).not.toContain("again to confirm")

  setup.app.mockInput.pressEnter()
  expect(await renamed.promise).toMatchObject({ title: "Disposable session" })
})
