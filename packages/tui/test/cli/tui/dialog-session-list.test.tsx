/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
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

test("scopes sessions to the active session location", async () => {
  const active = "/tmp/opencode/project-b"
  const events = createEventStream()
  const requestedProjects: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? process.cwd()
      const project = directory === active ? "proj_b" : "proj_a"
      return json({ directory, project: { id: project, directory, canonical: directory } })
    }
    if (url.pathname !== "/api/session") return undefined
    // Family syncs list children by parentID; only project-scoped list requests matter here.
    const parentID = url.searchParams.get("parentID")
    if (parentID && parentID !== "null") return json({ data: [], cursor: {} })
    const project = url.searchParams.get("project") ?? ""
    requestedProjects.push(project)
    return json({
      data: [
        {
          id: project === "proj_b" ? "ses_b" : "ses_a",
          projectID: project,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          title: project === "proj_b" ? "Project B session" : "Project A session",
          location: { directory: project === "proj_b" ? active : process.cwd() },
        },
      ],
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
        projectID: "proj_b",
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
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig()}>
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
    const frame = await app.waitForFrame((value) => value.includes("Project B session"))
    expect(frame).not.toContain("Project A session")
    expect(requestedProjects.at(-1)).toBe("proj_b")
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})

test("finds sessions by ses_ ID prefix via server search and local fallback", async () => {
  const events = createEventStream()
  const queries: Array<string | null> = []
  let failSearch = false
  const target = {
    id: "ses_alpha_12345",
    projectID: "proj_a",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 10 },
    title: "Deploy pipeline work",
    location: { directory: process.cwd() },
  }
  const other = {
    id: "ses_beta_99999",
    projectID: "proj_a",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 5 },
    title: "Refactor parser",
    location: { directory: process.cwd() },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      return json({
        directory: process.cwd(),
        project: { id: "proj_a", directory: process.cwd(), canonical: process.cwd() },
      })
    }
    if (url.pathname !== "/api/session") return undefined
    const search = url.searchParams.get("search")
    queries.push(search)
    if (failSearch) return new Response("error", { status: 500 })
    const all = [target, other]
    const filtered = !search
      ? all
      : all.filter(
          (session) =>
            session.title.toLowerCase().includes(search.toLowerCase()) ||
            (search.startsWith("ses_") && session.id.startsWith(search)),
        )
    return json({ data: filtered, cursor: {} })
  }, events)
  const temporary = await tmpdir()
  let storage!: ReturnType<typeof useStorage>
  let route!: ReturnType<typeof useRoute>

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    route = useRoute()
    storage = useStorage()
    onMount(() => {
      data.session.remember(target)
      data.session.remember(other)
      dialog.replace(() => <DialogSessionList />)
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig()}>
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
    await app.waitForFrame(
      (frame) =>
        frame.includes("Deploy pipeline work") &&
        frame.includes("Refactor parser") &&
        app.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    await app.mockInput.typeText("ses_alpha")
    await app.waitForFrame(
      (frame) =>
        queries.includes("ses_alpha") && frame.includes("Deploy pipeline work") && !frame.includes("Refactor parser"),
    )

    // Verify local fallback also matches ses_ ID prefixes when server search fails.
    failSearch = true
    await app.mockInput.typeText("_123")
    await app.waitForFrame(
      (frame) =>
        queries.includes("ses_alpha_123") &&
        frame.includes("Deploy pipeline work") &&
        !frame.includes("Refactor parser"),
    )

    app.mockInput.pressEnter()
    await app.waitFor(() => route.data.type === "session" && route.data.sessionID === target.id)
    expect(route.data).toEqual({ type: "session", sessionID: target.id })
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})

test("falls back to direct session.get when pasting an exact ses_ ID outside the scoped list", async () => {
  const events = createEventStream()
  const exactID = "ses_1234567890abcdefABCDEF1234"
  const foreign = {
    id: exactID,
    projectID: "proj_other",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 20 },
    title: "Foreign project session",
    location: { directory: "/tmp/opencode/other-project" },
  }
  const fetched: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      return json({
        directory: process.cwd(),
        project: { id: "proj_a", directory: process.cwd(), canonical: process.cwd() },
      })
    }
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${exactID}`) {
      fetched.push(exactID)
      return json({ data: foreign })
    }
    return undefined
  }, events)
  const temporary = await tmpdir()
  let storage!: ReturnType<typeof useStorage>
  let route!: ReturnType<typeof useRoute>

  function Probe() {
    const dialog = useDialog()
    route = useRoute()
    storage = useStorage()
    onMount(() => {
      dialog.replace(() => <DialogSessionList />)
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig()}>
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
    await app.waitForFrame(
      (frame) => frame.includes("Sessions") && app.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    // The @session:<id> form copied from a transcript resolves to the same session.
    await app.mockInput.typeText(`@session:${exactID}`)
    await app.waitForFrame((frame) => fetched.includes(exactID) && frame.includes("Foreign project session"))

    app.mockInput.pressEnter()
    await app.waitFor(() => route.data.type === "session" && route.data.sessionID === exactID)
    expect(route.data).toEqual({ type: "session", sessionID: exactID })
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})
