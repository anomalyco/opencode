/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import path from "path"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { DialogOpen, DialogOpenKey, loadDialogOpen } from "../../../src/component/dialog-open"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json, type FetchHandler } from "../../fixture/tui-client"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("selecting an unhydrated session preserves its location", async () => {
  const remote = { directory: "/tmp/opencode/remote", workspaceID: "ws_remote" }
  const fixture = await renderOpen((url) => {
    if (url.pathname !== "/api/session") return undefined
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
  })

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Remote session"))
    expect(fixture.data.session.get("ses_remote")).toBeUndefined()

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "session")

    expect(fixture.route.data).toEqual({ type: "session", sessionID: "ses_remote" })
    expect(fixture.location.ref).toEqual(remote)
  } finally {
    await fixture.dispose()
  }
})

test("finds and opens an exact session ID outside the recent list", async () => {
  const sessionID = "ses_04a7a3d82ffeIphUJgd3SnEqiv"
  const remote = { directory: "/tmp/opencode/archive", workspaceID: "ws_archive" }
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname !== `/api/session/${sessionID}`) return undefined
    return json({
      data: {
        id: sessionID,
        projectID: "proj_archive",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 },
        title: "TUI plugin slot API v2",
        location: remote,
      },
    })
  })

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Search sessions and projects"))
    await fixture.app.mockInput.typeText(sessionID)
    await fixture.app.waitForFrame((frame) => frame.includes("TUI plugin slot API v2"))

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "session")

    expect(fixture.route.data).toEqual({ type: "session", sessionID })
    expect(fixture.location.ref).toEqual(remote)
  } finally {
    fixture.dispose()
  }
})

test("shows the current project and opens its root", async () => {
  const root = "/tmp/opencode/project"
  const subfolder = `${root}/packages/tui`
  const fixture = await renderOpen(
    (url) => {
      if (url.pathname === "/api/project")
        return json([
          {
            id: "proj_current",
            canonical: root,
            name: "OpenCode",
            time: { created: 1, updated: 2 },
            sandboxes: [],
          },
        ])
      if (url.pathname === "/api/location")
        return json({
          directory: subfolder,
          project: { id: "proj_current", directory: root, canonical: root },
        })
      return undefined
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: subfolder })
      location.set({ directory: subfolder })
    },
  )

  try {
    const frame = await fixture.app.waitForFrame((value) => value.includes("OpenCode") && value.includes("●"))
    expect(frame).toContain(root)

    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")

    expect(fixture.route.data).toEqual({ type: "home", location: { directory: root } })
    expect(fixture.location.ref).toEqual({ directory: root })
  } finally {
    await fixture.dispose()
  }
})

test("includes unique sandbox and recent session directories, including global projects", async () => {
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/project")
      return json([
        {
          id: "proj_current",
          canonical: "/tmp/opencode/project",
          name: "OpenCode",
          time: { created: 1, updated: 2 },
          sandboxes: ["/tmp/opencode/feature-branch"],
        },
        {
          id: "global",
          canonical: "/",
          time: { created: 1, updated: 2 },
          sandboxes: [],
        },
      ])
    if (url.pathname !== "/api/session") return undefined
    return json({
      data: [
        {
          id: "ses_global",
          projectID: "global",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 3 },
          title: "Standalone session",
          location: { directory: "/tmp/standalone-notes" },
        },
        {
          id: "ses_worktree",
          projectID: "proj_current",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          title: "Worktree session",
          location: { directory: "/tmp/opencode/feature-branch" },
        },
      ],
      cursor: {},
    })
  })

  try {
    const frame = await fixture.app.waitForFrame(
      (value) => value.includes("Standalone session") && value.includes("feature-branch") && value.includes("Projects"),
    )
    expect(frame).toContain("standalone-notes")
    expect(frame).toContain("OpenCode · feature-branch")
    expect(frame.match(/\/tmp\/opencode\/feature-branch/g)).toHaveLength(1)

    await fixture.app.mockInput.typeText("standalone-notes")
    await fixture.app.waitForFrame((value) => value.includes("standalone-notes"))
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")
    expect(fixture.route.data).toEqual({ type: "home", location: { directory: "/tmp/standalone-notes" } })
  } finally {
    await fixture.dispose()
  }
})

test("shows nested Git session directories as projects and in their session footer", async () => {
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/project")
      return json([
        {
          id: "proj_current",
          canonical: "/tmp/opencode/project",
          name: "OpenCode",
          time: { created: 1, updated: 2 },
          sandboxes: [],
        },
      ])
    if (url.pathname !== "/api/session") return undefined
    return json({
      data: [
        {
          id: "ses_dashboard",
          projectID: "proj_current",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 2 },
          title: "Improve dashboard",
          location: { directory: "/tmp/opencode/project/packages/dashboard" },
        },
      ],
      cursor: {},
    })
  })

  try {
    const frame = await fixture.app.waitForFrame(
      (value) => value.includes("Improve dashboard") && value.includes("browse directories"),
    )
    expect(frame).toContain("OpenCode · dashboard")
    expect(frame).toContain("/tmp/opencode/project/packages/dashboard")
  } finally {
    await fixture.dispose()
  }
})

test("loads Git worktrees only when drilling into a project or its associated directory", async () => {
  const root = path.resolve("/tmp/opencode/project")
  const current = path.resolve("/tmp/opencode/current-branch")
  const other = path.resolve("/tmp/opencode/other-branch")
  const workspaceID = "ws_worktree"
  let requests = 0
  const fixture = await renderOpen(
    (url) => {
      if (url.pathname === "/api/project")
        return json([
          {
            id: "proj_git",
            canonical: root,
            name: "OpenCode",
            vcs: "git",
            time: { created: 1, updated: 2 },
            sandboxes: [current],
          },
        ])
      if (url.pathname === "/api/location")
        return json({
          directory: current,
          workspaceID,
          project: { id: "proj_git", directory: current, canonical: root },
        })
      if (url.pathname !== "/api/worktree/proj_git") return undefined
      requests++
      return json([{ directory: other, strategy: "git" }, { directory: root }, { directory: current, strategy: "git" }])
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: current, workspaceID })
      location.set({ directory: current, workspaceID })
    },
  )

  try {
    const projects = await fixture.app.waitForFrame(
      (frame) => frame.includes("OpenCode") && frame.includes("current-branch") && frame.includes("→"),
    )
    expect(projects).not.toContain("Browse directories")
    expect(requests).toBe(0)

    fixture.app.mockInput.pressArrow("right")
    const worktrees = await fixture.app.waitForFrame(
      (frame) => frame.includes("other-branch") && frame.includes("+ New worktree"),
    )
    expect(requests).toBe(1)
    expect(worktrees).toContain("Worktrees")
    expect(worktrees).toContain("●")
    expect(worktrees.indexOf("OpenCode")).toBeLessThan(worktrees.indexOf("current-branch"))
    expect(worktrees.indexOf("current-branch")).toBeLessThan(worktrees.indexOf("other-branch"))

    fixture.app.mockInput.pressArrow("left")
    await fixture.app.waitForFrame((frame) => frame.includes("Search sessions and projects"))
    await fixture.app.mockInput.typeText("current-branch")
    await fixture.app.waitForFrame((frame) => frame.includes("current-branch") && !frame.includes("OpenCode"))
    fixture.app.mockInput.pressArrow("right")
    await fixture.app.waitForFrame((frame) => frame.includes("other-branch") && frame.includes("+ New worktree"))
    expect(requests).toBe(2)

    await fixture.app.mockInput.typeText("other-branch")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")
    expect(fixture.route.data).toEqual({ type: "home", location: { directory: other, workspaceID } })
  } finally {
    await fixture.dispose()
  }
})

test("does not show or trigger worktree navigation for non-Git and global directories", async () => {
  const root = path.resolve("/tmp/plain-project")
  const standalone = path.resolve("/tmp/standalone-notes")
  let requests = 0
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/project")
      return json([
        { id: "proj_plain", canonical: root, name: "Plain project", time: { created: 1, updated: 2 }, sandboxes: [] },
        { id: "global", canonical: "/", time: { created: 1, updated: 1 }, sandboxes: [] },
      ])
    if (url.pathname === "/api/session")
      return json({
        data: [
          {
            id: "ses_global",
            projectID: "global",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 2 },
            title: "Standalone session",
            location: { directory: standalone },
          },
        ],
        cursor: {},
      })
    if (!url.pathname.startsWith("/api/worktree/")) return undefined
    requests++
    return json([])
  })

  try {
    const frame = await fixture.app.waitForFrame(
      (value) => value.includes("Plain project") && value.includes("standalone-notes"),
    )
    expect(frame).not.toContain("→")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("right")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("right")
    await fixture.app.renderOnce()
    expect(fixture.app.captureCharFrame()).toContain("Search sessions and projects")
    expect(requests).toBe(0)
  } finally {
    await fixture.dispose()
  }
})

test("creates an unnamed Git worktree and opens it in the current workspace", async () => {
  const projectID = "proj_git_create"
  const root = path.resolve("/tmp/opencode/project")
  const created = path.resolve("/tmp/opencode/created-branch")
  const workspaceID = "ws_create"
  let payload: unknown
  const fixture = await renderOpen(
    async (url, request) => {
      if (url.pathname === "/api/project")
        return json([
          {
            id: projectID,
            canonical: root,
            name: "OpenCode",
            vcs: "git",
            time: { created: 1, updated: 2 },
            sandboxes: [],
          },
        ])
      if (url.pathname === "/api/location")
        return json({ directory: root, workspaceID, project: { id: projectID, directory: root, canonical: root } })
      if (url.pathname !== `/api/worktree/${projectID}`) return undefined
      if (request.method === "GET") return json([{ directory: root }])
      payload = await request.json()
      return json({ directory: created })
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: root, workspaceID })
      location.set({ directory: root, workspaceID })
    },
  )

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("OpenCode") && frame.includes("→"))
    fixture.app.mockInput.pressArrow("right")
    await fixture.app.waitForFrame((frame) => frame.includes("+ New worktree"))
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")

    expect(payload).toEqual({
      strategy: "git",
      directory: path.join("/tmp/opencode", projectID.slice(0, 6)),
    })
    expect(fixture.route.data).toEqual({ type: "home", location: { directory: created, workspaceID } })
    expect(fixture.location.ref).toEqual({ directory: created, workspaceID })
  } finally {
    await fixture.dispose()
  }
})

test("keeps directory browsing in the footer and clears its search when toggling the browser", async () => {
  const root = path.resolve(
    "/private/var/folders/very-long-temporary-directory/opencode-drive/run-6462634d-8106-4652-ab87-e7e3cf5177ad/files",
  )
  const fixture = await renderOpen(
    (url) => {
      if (url.pathname === "/api/location")
        return json({ directory: root, project: { id: "proj_current", directory: root, canonical: root } })
      if (url.pathname !== "/api/fs/list") return undefined
      return json({
        location: { directory: root, project: { id: "proj_current", directory: root, canonical: root } },
        data: [{ path: "packages", type: "directory" }],
      })
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: root })
      location.set({ directory: root })
    },
  )

  try {
    const initial = await fixture.app.waitForFrame((frame) => frame.includes("browse directories"))
    expect(initial).not.toContain("Browse directories")
    await fixture.app.mockInput.typeText("missing")
    await fixture.app.waitForFrame((frame) => frame.includes("No matches"))
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    const browser = await fixture.app.waitForFrame(
      (frame) => frame.includes("Open this directory") && frame.includes("packages"),
    )
    expect(browser).not.toContain("No matching directories")

    await fixture.app.mockInput.typeText("packages")
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    const projects = await fixture.app.waitForFrame((frame) => frame.includes("Search sessions and projects"))
    expect(projects).toContain("browse directories")
    expect(projects).not.toContain("Browse directories")
  } finally {
    await fixture.dispose()
  }
})

test("browses from the current directory and opens an arbitrary child directory", async () => {
  const root = path.resolve("/tmp/opencode/project")
  const packages = path.resolve(root, "packages")
  const untracked = path.resolve(packages, "untracked")
  const workspaceID = "ws_browser"
  const fixture = await renderOpen(
    (url) => {
      if (url.pathname === "/api/location")
        return json({ directory: root, workspaceID, project: { id: "proj_current", directory: root, canonical: root } })
      if (url.pathname !== "/api/fs/list") return undefined
      expect(url.searchParams.get("location[workspace]")).toBe(workspaceID)
      const current = url.searchParams.get("location[directory]")
      return json({
        location: {
          directory: current,
          workspaceID,
          project: { id: "proj_current", directory: root, canonical: root },
        },
        data:
          current === root
            ? [
                { path: "packages", type: "directory" },
                { path: "README.md", type: "file" },
              ]
            : current && path.normalize(current) === path.normalize(packages)
              ? [{ path: "untracked", type: "directory" }]
              : [],
      })
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: root, workspaceID })
      location.set({ directory: root, workspaceID })
    },
  )

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("browse"))
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    const rootFrame = await fixture.app.waitForFrame(
      (frame) => frame.includes("Open this directory") && frame.includes("packages"),
    )
    expect(rootFrame).not.toContain("README.md")

    fixture.app.mockInput.pressArrow("down", { meta: true })
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("untracked"))

    fixture.app.mockInput.pressArrow("down", { meta: true })
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes(untracked))
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")
    expect(fixture.route.data).toEqual({
      type: "home",
      location: { directory: untracked, workspaceID },
    })
  } finally {
    await fixture.dispose()
  }
})

test("navigates to the parent directory and returns to the project picker", async () => {
  const root = path.resolve("/tmp/opencode/project")
  const parent = path.dirname(root)
  const fixture = await renderOpen(
    (url) => {
      if (url.pathname === "/api/location")
        return json({ directory: root, project: { id: "proj_current", directory: root, canonical: root } })
      if (url.pathname !== "/api/fs/list") return undefined
      const current = url.searchParams.get("location[directory]")
      return json({
        location: { directory: current, project: { id: "proj_current", directory: root, canonical: root } },
        data:
          current && path.normalize(current) === path.normalize(parent) ? [{ path: "sibling", type: "directory" }] : [],
      })
    },
    async ({ data, location }) => {
      await data.location.sync({ directory: root })
      location.set({ directory: root })
    },
  )

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("browse"))
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("Open this directory"))
    fixture.app.mockInput.pressKey("u", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("sibling") && frame.includes(parent))
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("Search sessions and projects"))
    expect(fixture.location.ref).toEqual({ directory: root })
  } finally {
    await fixture.dispose()
  }
})

test("waits for sessions before showing the populated picker", async () => {
  let resolveSessions!: (response: Response) => void
  const sessions = new Promise<Response>((resolve) => (resolveSessions = resolve))
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/session") return sessions
    if (url.pathname === "/api/project")
      return json([
        {
          id: "proj_first",
          canonical: "/tmp/opencode/first",
          name: "First project",
          time: { created: 1, updated: 2 },
          sandboxes: [],
        },
        {
          id: "proj_second",
          canonical: "/tmp/opencode/second",
          name: "Second project",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
      ])
    return undefined
  })

  try {
    await fixture.app.renderOnce()
    expect(fixture.app.captureCharFrame()).not.toContain("Search sessions and projects")

    resolveSessions(
      json({
        data: [
          {
            id: "ses_recent",
            projectID: "proj_first",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 2, updated: 3 },
            title: "Recent session",
            location: { directory: "/tmp/opencode/first" },
          },
        ],
        cursor: {},
      }),
    )
    await fixture.app.waitForFrame((frame) => frame.includes("Recent session") && frame.includes("Second project"))
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressArrow("down")
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")

    expect(fixture.route.data).toEqual({ type: "home", location: { directory: "/tmp/opencode/second" } })
  } finally {
    await fixture.dispose()
  }
})

test("option arrows jump between sections", async () => {
  const handler: FetchHandler = (url) => {
    if (url.pathname === "/api/session")
      return json({
        data: [
          {
            id: "ses_recent",
            projectID: "proj_recent",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 2 },
            title: "Recent session",
            location: { directory: "/tmp/opencode/recent" },
          },
        ],
        cursor: {},
      })
    if (url.pathname === "/api/project")
      return json([
        {
          id: "proj_recent",
          canonical: "/tmp/opencode/recent",
          name: "Recent project",
          time: { created: 1, updated: 2 },
          sandboxes: [],
        },
      ])
    return undefined
  }

  const next = await renderOpen(handler)
  try {
    await next.app.waitForFrame((frame) => frame.includes("Recent session") && frame.includes("Recent project"))
    next.app.mockInput.pressArrow("down", { meta: true })
    next.app.mockInput.pressEnter()
    await next.app.waitFor(() => next.route.data.type === "home")
    expect(next.route.data).toEqual({ type: "home", location: { directory: "/tmp/opencode/recent" } })
  } finally {
    await next.dispose()
  }

  const previous = await renderOpen(handler)
  try {
    await previous.app.waitForFrame((frame) => frame.includes("Recent session") && frame.includes("Recent project"))
    previous.app.mockInput.pressArrow("up", { meta: true })
    previous.app.mockInput.pressEnter()
    await previous.app.waitFor(() => previous.route.data.type === "home")
    expect(previous.route.data).toEqual({ type: "home", location: { directory: "/tmp/opencode/recent" } })
  } finally {
    await previous.dispose()
  }
})

test("option arrows stay in the only visible section", async () => {
  const fixture = await renderOpen((url) => {
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname !== "/api/project") return undefined
    return json([
      {
        id: "proj_effect",
        canonical: "/tmp/effect",
        name: "Effect",
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
      {
        id: "proj_opencode",
        canonical: "/tmp/opencode",
        name: "OpenCode",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      },
    ])
  })

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && frame.includes("OpenCode"))
    await fixture.app.mockInput.typeText("Effect")
    await fixture.app.waitForFrame((frame) => frame.includes("Effect") && !frame.includes("OpenCode"))
    fixture.app.mockInput.pressArrow("down", { meta: true })
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitFor(() => fixture.route.data.type === "home")
    expect(fixture.route.data).toEqual({ type: "home", location: { directory: "/tmp/effect" } })
  } finally {
    await fixture.dispose()
  }
})

async function renderOpen(
  handler: FetchHandler,
  beforeOpen?: (contexts: {
    data: ReturnType<typeof useData>
    location: ReturnType<typeof useLocation>
  }) => void | Promise<void>,
) {
  const temporary = await tmpdir()
  const state = temporary.path
  const events = createEventStream()
  const calls = createFetch(handler, events)
  let route!: ReturnType<typeof useRoute>
  let location!: ReturnType<typeof useLocation>
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>

  function Probe() {
    const dialog = useDialog()
    const client = useClient()
    route = useRoute()
    location = useLocation()
    data = useData()
    storage = useStorage()
    onMount(
      () =>
        void Promise.all([beforeOpen?.({ data, location }), loadDialogOpen(data, client)]).then(([, sessions]) =>
          dialog.replace(() => <DialogOpen sessions={sessions} />, undefined, { key: DialogOpenKey, size: "large" }),
        ),
    )
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
                      <DataProvider directory={process.cwd()}>
                        <LocationProvider>
                          <SessionTabsProvider>
                            <ThemeProvider mode="dark" source={emptyThemeSource}>
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

  return {
    app,
    get route() {
      return route
    },
    get location() {
      return location
    },
    get data() {
      return data
    },
    async dispose() {
      app.renderer.destroy()
      await storage.flush()
      await temporary[Symbol.asyncDispose]()
    },
  }
}
