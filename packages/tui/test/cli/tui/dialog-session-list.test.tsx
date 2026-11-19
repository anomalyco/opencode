/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { DialogSessionList } from "../../../src/component/dialog-session-list"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each(["", "packages/tui"])("scopes sessions to the active worktree directory (%s)", async (subpath) => {
  const root = "/tmp/opencode/project-b"
  const active = subpath ? `${root}/${subpath}` : root
  const sibling = subpath ? `/tmp/opencode/project-a/${subpath}` : "/tmp/opencode/project-a"
  const events = createEventStream()
  const requests: URLSearchParams[] = []
  const sessions: SessionInfo[] = [
    { id: "ses_b", title: "Current worktree session", directory: active },
    { id: "ses_a", title: "Sibling worktree session", directory: sibling },
  ].map((session) => ({
    id: session.id,
    title: session.title,
    projectID: "proj_shared",
    subpath,
    location: { directory: session.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  }))
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? process.cwd()
      return json({
        directory,
        project: {
          id: "proj_shared",
          directory: directory === active ? root : directory,
          canonical: "/tmp/opencode/project-a",
        },
      })
    }
    if (url.pathname !== "/api/session") return undefined
    // Family syncs list children by parentID; only top-level list requests matter here.
    const parentID = url.searchParams.get("parentID")
    if (parentID && parentID !== "null") return json({ data: [], cursor: {} })
    requests.push(url.searchParams)
    return json({
      data: sessions.filter(
        (session) =>
          !url.searchParams.has("directory") || session.location.directory === url.searchParams.get("directory"),
      ),
      cursor: {},
    })
  }, events)
  const temporary = await tmpdir()
  let storage!: ReturnType<typeof useStorage>

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    const route = useRoute()
    storage = useStorage()
    onMount(() => {
      data.session.remember({
        id: "ses_active",
        projectID: "proj_shared",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 3 },
        title: "Active session",
        location: { directory: active },
      })
      route.navigate({ type: "session", sessionID: "ses_active" })
      dialog.replace(() => <DialogSessionList />)
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path, home: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig({ tabs: { scope: "cwd" } })}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={process.cwd()}>
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

  try {
    const frame = await app.waitForFrame((value) => value.includes("Current worktree session"))
    expect(frame).not.toContain("Sibling worktree session")
    expect(requests.at(-1)?.get("directory")).toBe(active)
    expect(requests.at(-1)?.has("project")).toBe(false)
    expect(requests.at(-1)?.has("subpath")).toBe(false)

    app.mockInput.pressKey("a", { ctrl: true })
    const all = await app.waitForFrame((value) => value.includes("Sibling worktree session"))
    expect(all).toContain("Current worktree session")
    expect(requests.at(-1)?.has("directory")).toBe(false)
    expect(requests.at(-1)?.has("project")).toBe(false)

    app.mockInput.pressKey("a", { ctrl: true })
    await app.waitForFrame(
      (value) => value.includes("Current worktree session") && !value.includes("Sibling worktree session"),
    )
    expect(requests.at(-1)?.get("directory")).toBe(active)
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})
