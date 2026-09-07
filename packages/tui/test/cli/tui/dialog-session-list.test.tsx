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
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("scopes sessions to the active location and follows its project identity while open", async () => {
  const active = "/tmp/opencode/project-b"
  const events = createEventStream()
  const identity = { project: "proj_b" }
  const requestedProjects: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? process.cwd()
      const project = directory === active ? identity.project : "proj_a"
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
          id: project === "proj_a" ? "ses_a" : "ses_b",
          projectID: project,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          title:
            project === "proj_b_identified"
              ? "Identified project session"
              : project === "proj_b"
                ? "Project B session"
                : "Project A session",
          location: { directory: project === "proj_a" ? process.cwd() : active },
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

    identity.project = "proj_b_identified"
    events.emit({
      id: "evt_project_identified",
      created: 4,
      type: "worktree.resolved",
      durable: { aggregateID: identity.project, seq: 0, version: 1 },
      data: { projectID: identity.project, directory: active, previous: "proj_b" },
    })
    const updated = await app.waitForFrame((value) => value.includes("Identified project session"))
    expect(updated).not.toContain("Project A session")
    expect(requestedProjects.at(-1)).toBe(identity.project)
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})
