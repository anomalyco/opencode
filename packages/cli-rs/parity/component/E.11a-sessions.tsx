/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the session list (packages/tui/src/component/dialog-session-list.tsx) and the open
// dialog (component/dialog-open.tsx). crates/tui/tests/sessions.rs mounts the Rust TUI over the same
// responses (`E11A` below; keep both in step), hides the screen behind the dialog, sends the same keys, and
// compares the cells. Tabs are off, so pins and the quick switch hint show; `ses_b` is pinned.
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { createSignal, onMount, type JSX } from "solid-js"
import { DialogOpen } from "../../../tui/src/component/dialog-open"
import { DialogSessionList } from "../../../tui/src/component/dialog-session-list"
import { ConfigProvider } from "../../../tui/src/config"
import { ArgsProvider } from "../../../tui/src/context/args"
import { ClientProvider } from "../../../tui/src/context/client"
import { DataProvider, useData } from "../../../tui/src/context/data"
import { Keymap } from "../../../tui/src/context/keymap"
import { LocalProvider } from "../../../tui/src/context/local"
import { LocationProvider } from "../../../tui/src/context/location"
import { PermissionProvider } from "../../../tui/src/context/permission"
import { RouteProvider } from "../../../tui/src/context/route"
import { TuiAppProvider } from "../../../tui/src/context/runtime"
import { SessionTabsProvider } from "../../../tui/src/context/session-tabs"
import { StorageProvider } from "../../../tui/src/context/storage"
import { ThemeProvider } from "../../../tui/src/context/theme"
import { DialogProvider, useDialog } from "../../../tui/src/ui/dialog"
import { ToastProvider } from "../../../tui/src/ui/toast"
import { emptyThemeSource } from "../../../tui/test/fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../../tui/test/fixture/tui-client"
import { TestTuiContexts } from "../../../tui/test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { renderComponent } from "../lib/component"

const directory = "/tmp/opencode/app"
const noon = (day: number) => Date.UTC(2026, 2, day, 12)
const session = (id: string, title: string | undefined, updated: number, extra: Record<string, unknown> = {}) => ({
  id,
  projectID: "proj_app",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: updated, updated },
  ...(title === undefined ? {} : { title }),
  location: { directory },
  ...extra,
})
const scoped = [
  session("ses_b", "Write docs", noon(3) - 3_600_000),
  session("ses_a", "Fix the parser", noon(3)),
  session("ses_c", undefined, noon(1), { location: { directory: "/tmp/opencode/app-feature" } }),
]
const other = session("ses_d", "Other project", noon(2), {
  projectID: "proj_other",
  location: { directory: "/tmp/other" },
})
// The open dialog shows relative times, so its sessions are relative to now: 5m, 3h, 2d, and 40d ago.
const now = Date.now()
const recent = [
  session("ses_r1", "Review the plan", now - 5 * 60_000),
  session("ses_r2", "Fix the parser", now - 3 * 3_600_000),
  session("ses_r3", "Explore the worktree", now - 2 * 86_400_000, { location: { directory: "/tmp/opencode/app-feature" } }),
]
const recentOther = session("ses_r4", "Other project", now - 40 * 86_400_000, {
  projectID: "proj_other",
  location: { directory: "/tmp/other" },
})
let mode: "list" | "open" = "list"

const projects = [
  {
    id: "proj_app",
    canonical: directory,
    name: "App",
    vcs: "git",
    time: { created: 1, updated: 2, active: 3 },
    sandboxes: [],
  },
  { id: "proj_other", canonical: "/tmp/other", time: { created: 1, updated: 2, active: 2 }, sandboxes: [] },
]

const calls = createFetch((url) => {
  if (url.pathname === "/api/location")
    return json({ directory, project: { id: "proj_app", directory, canonical: directory } })
  if (url.pathname === "/api/project") return json(projects)
  if (url.pathname === "/api/worktree") return json([{ directory: "/tmp/opencode/app-feature" }])
  if (url.pathname !== "/api/session") return undefined
  const search = url.searchParams.get("search")
  const all = url.searchParams.get("project") === null && url.searchParams.get("directory") === null
  const base = mode === "open" ? recent : scoped
  const extra = mode === "open" ? recentOther : other
  const sessions = [...base, ...(all ? [extra] : [])].toSorted((a, b) => b.time.updated - a.time.updated)
  return json({
    data: search ? sessions.filter((item) => item.title?.toLowerCase().includes(search)) : sessions,
    cursor: {},
  })
}, createEventStream())

function Probe(props: { open: () => JSX.Element }) {
  const data = useData()
  const dialog = useDialog()
  onMount(() => {
    // The Rust home reads the same sessions into its store before the dialog opens.
    for (const item of mode === "open" ? recent : scoped) data.session.remember(item as never)
    dialog.replace(props.open)
  })
  return null
}

type Act = Parameters<typeof renderComponent>[0]["act"]

// `ready` must hold before and after `act`: renderComponent waits for it on both sides.
async function render(fixture: string, open: () => JSX.Element, ready: (frame: string) => boolean, act?: Act) {
  const state = await mkdtemp(path.join(os.tmpdir(), "opencode-e11a-"))
  await Bun.write(path.join(state, "session.json"), JSON.stringify({ pinned: ["ses_b"] }))
  try {
    await renderComponent({
      fixture,
      width: 100,
      height: 34,
      bare: () => (
        <TestTuiContexts paths={{ state, home: "/tmp/opencode/home" }} directory={directory}>
          <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
            <StorageProvider>
              <ArgsProvider>
                <ConfigProvider config={createTuiResolvedConfig({ tabs: { mode: "off" }, animations: false })}>
                  <Keymap.Provider>
                    <ToastProvider>
                      <RouteProvider initialRoute={{ type: "home" }}>
                        <ClientProvider api={createApi(calls.fetch)}>
                          <PermissionProvider>
                            <DataProvider directory={directory}>
                              <LocationProvider>
                                <SessionTabsProvider>
                                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                                    <LocalProvider>
                                      <DialogProvider>
                                        <Probe open={open} />
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
      ready,
      act,
    })
  } finally {
    await rm(state, { recursive: true, force: true })
  }
}

const list = () => <DialogSessionList />
const listed = (frame: string) => frame.includes("ctrl+a") && !frame.includes("Loading") && !frame.includes("Searching")
await render("E.11a/sessions", list, (frame) => frame.includes("Fix the parser"))
await render("E.11a/sessions-delete", list, listed, async (setup) => {
  setup.mockInput.pressKey("d", { ctrl: true })
  await Bun.sleep(50)
})
await render("E.11a/sessions-all", list, listed, async (setup) => {
  setup.mockInput.pressKey("a", { ctrl: true })
  await Bun.sleep(400)
})
await render("E.11a/sessions-search", list, listed, async (setup) => {
  await setup.mockInput.typeText("docs")
  await Bun.sleep(400)
})

// As app.tsx keeps `openSessions`: the recent read feeds back into the dialog.
function OpenHost() {
  const [sessions, setSessions] = createSignal<never[]>([])
  return <DialogOpen sessions={sessions()} onLoad={(loaded) => setSessions(loaded as never[])} />
}
const open = () => <OpenHost />
mode = "open"
const opened = (frame: string) => frame.includes("App") && !frame.includes("Refreshing")
await render("E.11a/open", open, (frame) => opened(frame) && frame.includes("Projects"))
await render("E.11a/open-worktrees", open, opened, async (setup) => {
  // Down past the four sessions to the App project, then into its worktrees.
  for (let index = 0; index < 4; index++) setup.mockInput.pressArrow("down")
  await Bun.sleep(50)
  setup.mockInput.pressArrow("right")
  await Bun.sleep(300)
})
