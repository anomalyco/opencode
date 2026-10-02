/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
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
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { SPINNER_FRAMES } from "../../../src/component/spinner-frames"
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

test.each([
  { mode: "dark" as const, tabs: "off" as const, width: 100 },
  { mode: "light" as const, tabs: "on" as const, width: 60 },
])("shows and clears pending input in $mode with tabs $tabs", async ({ mode, tabs, width }) => {
  const events = createEventStream()
  const sessions = ["Question", "Permission", "Working", "Idle", "Child"].map((title, index) => ({
    id: `ses_${title.toLowerCase()}`,
    parentID: title === "Child" ? "ses_question" : undefined,
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 10 - index },
    title,
    location: { directory: process.cwd() },
  }))
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? process.cwd()
      return json({ directory, project: { id: "proj_test", directory, canonical: directory } })
    }
    if (url.pathname === "/api/session") {
      const parentID = url.searchParams.get("parentID")
      return json({
        data: sessions.filter((session) =>
          parentID && parentID !== "null" ? session.parentID === parentID : !session.parentID,
        ),
        cursor: {},
      })
    }
    const id = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (id && id !== "active") return json({ data: sessions.find((session) => session.id === id) })
    return undefined
  }, events)
  await using temporary = await tmpdir()
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>
  let theme!: ReturnType<typeof useTheme>

  function Probe() {
    data = useData()
    storage = useStorage()
    theme = useTheme().surface("dialog")
    const dialog = useDialog()
    onMount(() => {
      sessions.forEach((session) => data.session.remember(session))
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
              <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: tabs } })}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={process.cwd()}>
                            <LocationProvider>
                              <SessionTabsProvider>
                                <ThemeProvider mode={mode} source={emptyThemeSource}>
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
    { width, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  const row = (frame: string, title: string) => frame.split("\n").find((line) => line.includes(title)) ?? ""
  const spinning = (line: string) => SPINNER_FRAMES.some((glyph) => line.includes(glyph))
  const question = (id: string, sessionID: string) =>
    events.emit({
      id: `evt_${id}`,
      created: 1,
      type: "form.created",
      location: { directory: process.cwd() },
      data: {
        form: {
          id,
          sessionID,
          title: "Choose an approach",
          fields: [{ key: "approach", type: "string", title: "Approach" }],
        },
      },
    })
  const permission = (id: string, sessionID: string) =>
    events.emit({
      id: `evt_${id}`,
      created: 2,
      type: "permission.asked",
      data: { id, sessionID, action: "shell", resources: ["echo fixture"] },
    })
  const color = (title: string) =>
    app
      .captureSpans()
      .lines.find((line) => line.spans.some((span) => span.text.includes(title)))
      ?.spans.find((span) => span.text.includes("●") || span.text.includes("△"))?.fg

  try {
    await app.waitForFrame((frame) => frame.includes("Question") && frame.includes("Idle"))
    data.session.setStatus("ses_question", "running")
    data.session.setStatus("ses_permission", "running")
    data.session.setStatus("ses_working", "running")
    await app.waitForFrame(
      (frame) =>
        spinning(row(frame, "Question")) && spinning(row(frame, "Permission")) && spinning(row(frame, "Working")),
    )
    question("frm_question", "ses_child")
    permission("per_command", "ses_permission")
    const after = await app.waitForFrame(
      (frame) =>
        row(frame, "Question").includes("Answer required") && row(frame, "Permission").includes("Permission required"),
    )
    for (const title of ["Question", "Permission"]) {
      expect(row(after, title)).toContain(title === "Permission" ? "△" : "●")
      expect(spinning(row(after, title))).toBe(false)
    }
    expect(color("Question")?.toInts()).toEqual(theme.text.feedback.info.base.toInts())
    expect(color("Permission")?.toInts()).toEqual(theme.text.feedback.warning.base.toInts())
    expect(spinning(row(after, "Working"))).toBe(true)
    expect(spinning(row(after, "Idle"))).toBe(false)
    expect(after).not.toContain("Child")

    permission("per_child", "ses_child")
    const blocked = await app.waitForFrame((frame) => row(frame, "Question").includes("Permission required"))
    expect(row(blocked, "Question")).toContain("△")
    expect(row(blocked, "Question")).not.toContain("●")
    expect(color("Question")?.toInts()).toEqual(theme.text.feedback.warning.base.toInts())
    for (const reply of ["once", "always", "reject"] as const) {
      permission("per_child", "ses_child")
      await app.waitForFrame((frame) => row(frame, "Question").includes("Permission required"))
      events.emit({
        id: `evt_reply_${reply}`,
        created: 3,
        type: "permission.replied",
        data: { sessionID: "ses_child", requestID: "per_child", reply },
      })
      await app.waitForFrame((frame) => row(frame, "Question").includes("Answer required"))
    }
    events.emit({
      id: "evt_answer",
      created: 4,
      type: "form.replied",
      data: { sessionID: "ses_child", id: "frm_question", answer: { approach: "simple" } },
    })
    await app.waitForFrame((frame) => !row(frame, "Question").includes("required") && spinning(row(frame, "Question")))
    question("frm_cancel", "ses_question")
    await app.waitForFrame((frame) => row(frame, "Question").includes("Answer required"))
    events.emit({
      id: "evt_cancel",
      created: 5,
      type: "form.cancelled",
      data: { sessionID: "ses_question", id: "frm_cancel" },
    })
    await app.waitForFrame((frame) => !row(frame, "Question").includes("required") && spinning(row(frame, "Question")))
    data.session.setStatus("ses_question", "idle")
    await app.waitForFrame((frame) => !spinning(row(frame, "Question")))
    permission("per_idle", "ses_question")
    await app.waitForFrame((frame) => row(frame, "Question").includes("Permission required"))
    events.emit({
      id: "evt_idle_reply",
      created: 6,
      type: "permission.replied",
      data: { sessionID: "ses_question", requestID: "per_idle", reply: "reject" },
    })
    const idle = await app.waitForFrame((frame) => !row(frame, "Question").includes("required"))
    expect(spinning(row(idle, "Question"))).toBe(false)
    expect(row(idle, "Question")).not.toContain("●")
    expect(row(idle, "Question")).not.toContain("△")
  } finally {
    app.renderer.destroy()
    await storage.flush()
  }
})
