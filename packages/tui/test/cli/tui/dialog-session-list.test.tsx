/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { InputRenderable } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { createSignal, onMount } from "solid-js"
import { DialogSessionList, sessionStatusGutter } from "../../../src/component/dialog-session-list"
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
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("session gutter prioritizes attention, running, unread, then the quick-switch slot", async () => {
  const [attention, setAttention] = createSignal<"permission" | "question" | false>(false)
  const [running, setRunning] = createSignal(false)
  const [unread, setUnread] = createSignal<"activity" | "error" | undefined>("activity")
  let theme!: ReturnType<ReturnType<typeof useTheme>["surface"]>
  function Gutter() {
    theme = useTheme().surface("dialog")
    return (
      <box>{sessionStatusGutter(theme, attention(), running(), () => <text>3</text>, unread())?.(theme.text.base)}</box>
    )
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Gutter />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 10, height: 3 },
  )
  app.renderer.pause()
  try {
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("•")
    expect(app.captureSpans().lines[0]!.spans[0]!.fg?.toInts()).toEqual(theme.text.feedback.success.base.toInts())
    setUnread("error")
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("•")
    expect(app.captureSpans().lines[0]!.spans[0]!.fg?.toInts()).toEqual(theme.text.feedback.error.base.toInts())
    setRunning(true)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("⋯")
    setAttention("question")
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("?")
    setAttention("permission")
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("!")
    setAttention(false)
    setRunning(false)
    setUnread(undefined)
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("3")
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  { width: 100, mode: "on" as const },
  { width: 44, mode: "off" as const },
])("shows unread completions in the picker ($width columns, tabs $mode)", async ({ width, mode }) => {
  await using temporary = await tmpdir()
  const sessions: SessionInfo[] = [
    { title: "Unread completion", time: { created: 1, updated: 7, idle: 6, viewed: 5 } },
    { title: "Unread failure", time: { created: 1, updated: 6, idle: 6 }, outcome: "failed" as const },
    { title: "Read completion", time: { created: 1, updated: 5, idle: 5, viewed: 5 } },
    { title: "Never completed", time: { created: 1, updated: 4 } },
  ].map((info, index) => ({
    id: `ses_picker_${index}`,
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    location: { directory: temporary.path },
    ...info,
  }))
  const events = createEventStream()
  const views: string[] = []
  const searched = Promise.withResolvers<void>()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location")
      return json({ directory: temporary.path, project: { id: "proj_test", directory: temporary.path } })
    if (url.pathname === "/api/session") {
      const parent = url.searchParams.get("parentID")
      if (parent && parent !== "null") return json({ data: [], cursor: {} })
      const search = url.searchParams.get("search")?.toLowerCase() ?? ""
      if (search) searched.resolve()
      return json({ data: sessions.filter((session) => session.title?.toLowerCase().includes(search)), cursor: {} })
    }
    const session = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
    if (session) return json(session)
    const viewed = sessions.find((session) => url.pathname === `/api/session/${session.id}/view`)
    if (viewed) {
      views.push(viewed.id)
      viewed.time.viewed = (await request.json()).idle
      data.session.remember(viewed)
      return new Response(null, { status: 204 })
    }
    if (/^\/api\/session\/[^/]+\/pending$/.test(url.pathname)) return json({ data: [] })
    return undefined
  }, events)
  let data!: ReturnType<typeof useData>
  let dialog!: ReturnType<typeof useDialog>
  let storage!: ReturnType<typeof useStorage>
  function Probe() {
    data = useData()
    dialog = useDialog()
    storage = useStorage()
    onMount(() => dialog.replace(() => <DialogSessionList />))
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path, home: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig({ animations: false, tabs: { mode } })}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={temporary.path}>
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
    { width, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  app.renderer.emit("focus")
  try {
    const frame = await app.waitForFrame(
      (frame) => frame.includes("Never completed") && app.renderer.currentFocusedRenderable instanceof InputRenderable,
    )
    expect(frame).toContain("• Unread completion")
    expect(frame).toContain("• Unread failure")
    expect(frame).not.toContain("• Read completion")
    expect(frame).not.toContain("• Never completed")
    expect(data.session.get(sessions[0]!.id)).toBeUndefined()
    expect(views).toEqual([])

    // A row being highlighted is not a view, including after a server-side search.
    await app.mockInput.typeText("Unread completion")
    await searched.promise
    await app.waitForFrame((frame) => frame.includes("• Unread completion") && !frame.includes("Searching sessions"))
    expect(views).toEqual([])

    // Live metadata wins over the stale result returned by the list endpoint.
    data.session.remember({ ...sessions[0]!, time: { ...sessions[0]!.time, viewed: 6 } })
    await app.waitForFrame((frame) => frame.includes("Unread completion") && !frame.includes("• Unread completion"))
    data.session.remember(sessions[0]!)
    await app.waitForFrame((frame) => frame.includes("• Unread completion"))
    data.session.setStatus(sessions[0]!.id, "running")
    await app.waitForFrame((frame) => frame.includes("⋯ Unread completion"))
    data.session.setStatus(sessions[0]!.id, "idle")
    await app.waitForFrame((frame) => frame.includes("• Unread completion"))
    await app.mockInput.pressEnter()
    await app.waitForFrame(() => views.includes(sessions[0]!.id))
    dialog.replace(() => <DialogSessionList />)
    await app.waitForFrame((frame) => frame.includes("Unread completion") && !frame.includes("• Unread completion"))
    expect(views).toEqual([sessions[0]!.id])
  } finally {
    app.renderer.destroy()
    await storage.flush()
  }
})

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
