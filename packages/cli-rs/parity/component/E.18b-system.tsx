/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the system dialogs (E.18b): crates/tui/tests/system.rs opens the Rust dialogs over the whole
// TUI with the same responses (keep `SERVERS` and the other data below in step with it) and compares the dialog
// panel.
import { onMount, type JSX } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
// The plugin context registers every builtin, and the plugins dialog imports the context back, so the context
// loads first, as in the app.
import type { usePlugin } from "../../../tui/src/plugin/context"
import "../../../tui/src/plugin/context"
import { PluginsDialog } from "../../../tui/src/feature-plugins/system/plugins"
import { usePathFormatter } from "../../../tui/src/context/path-format"
import { useThemes } from "../../../tui/src/context/theme"
import { DialogHighlights } from "../../../tui/src/component/dialog-highlights"
import { DialogPair } from "../../../tui/src/component/dialog-pair"
import { DialogUpdate } from "../../../tui/src/component/dialog-update"
import { DialogStatus } from "../../../tui/src/component/dialog-status"
import { DialogThemeList } from "../../../tui/src/component/dialog-theme-list"
import { ConfigProvider } from "../../../tui/src/config"
import { ClientProvider } from "../../../tui/src/context/client"
import { DataProvider, useData } from "../../../tui/src/context/data"
import { Keymap } from "../../../tui/src/context/keymap"
import { LocationProvider } from "../../../tui/src/context/location"
import { RouteProvider } from "../../../tui/src/context/route"
import { ThemeProvider } from "../../../tui/src/context/theme"
import { DialogProvider, useDialog } from "../../../tui/src/ui/dialog"
import { ToastProvider } from "../../../tui/src/ui/toast"
import { emptyThemeSource } from "../../../tui/test/fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../../tui/test/fixture/tui-client"
import { TestTuiContexts } from "../../../tui/test/fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { withNewDesigns } from "../lib/app"
import { renderComponent } from "../lib/component"

const directory = "/tmp/opencode/app"
const location = { directory, project: { id: "proj_app", directory, canonical: directory } }

const SERVERS = [
  { name: "linear", status: { status: "failed", error: "MCP error -32000: Connection closed" } },
  { name: "github", status: { status: "connected" } },
  { name: "sentry", status: { status: "needs_auth", error: "Authentication required" } },
  { name: "docs", status: { status: "disabled" } },
  { name: "figma", status: { status: "pending" } },
]

let servers: unknown[] = SERVERS

// Server plugins: an outdated package, a failed local plugin, an internal built-in, and a package with only a TUI
// part, which the dialog leaves out.
const PLUGINS = [
  {
    id: "team.plugins",
    source: { type: "package", target: "git+ssh://git@github.com/example/team-plugins.git", version: "dadba13", outdated: true },
    features: { server: true },
    state: { status: "active" },
  },
  {
    id: "audit",
    source: { type: "local", path: `${directory}/.opencode/plugins/audit.ts` },
    features: { server: true },
    state: { status: "failed", error: "Cannot find module 'zod' from audit.ts", ref: "err_audit" },
  },
  { id: "opencode.core", source: { type: "builtin" }, features: { server: true }, state: { status: "active" } },
  { id: "theme.pack", source: { type: "package", target: "theme-pack" }, features: { tui: true }, state: { status: "active" } },
]

// The Rust built-ins (crates/tui/src/plugins/host.rs) and the plugin crates/tui/tests/system.rs adds.
const BUILTINS = [
  "opencode.home.footer",
  "opencode.prompt.footer",
  "opencode.btw",
  "opencode.sidebar.context",
  "opencode.sidebar.limit",
  "opencode.sidebar.mcp",
  "opencode.sidebar.todo",
  "opencode.sidebar.footer",
  "opencode.notifications",
  "opencode.plugins",
  "opencode.stats",
  "opencode.merman",
  "opencode.latex",
  "opencode.diffs",
]

const INFO = {
  version: "0.0.0-test",
  pid: 4242,
  urls: ["http://127.0.0.1:4096/", "http://192.168.1.20:4096/"],
  paths: { tmp: "/tmp" },
}
let pairFails = false

const calls = createFetch((url) => {
  if (url.pathname === "/api/location") return json(location)
  if (url.pathname === "/api/info") return json(INFO)
  if (url.pathname === "/api/pair")
    return pairFails
      ? json({ _tag: "ServiceUnavailable", message: "Pairing is disabled" }, { status: 503 })
      : json({ code: "XK7Q2M", expires_in: 600 })
  if (url.pathname === "/api/mcp") return json({ location, data: servers })
  if (url.pathname === "/api/plugin") return json({ location, data: PLUGINS })
  return undefined
}, createEventStream())

function Plugins() {
  const themes = useThemes()
  const paths = usePathFormatter()
  const context = {
    client: createApi(calls.fetch),
    data: { location: { default: () => ({ directory }) }, on: () => () => {} },
    get theme() {
      return themes.currentTokens()
    },
    ui: { toast: { show: () => {} }, format: { path: (value: string) => paths.format(value) } },
  } as unknown as Context
  const plugins = {
    registered: () => [
      ...BUILTINS.map((id) => ({ id, source: "builtin", active: true })),
      { id: "team.tui", source: "external", active: true },
    ],
    list: () => [{ target: "team.tui", id: "team.tui", status: "active" }],
    activate: async () => true,
    deactivate: async () => true,
  } as unknown as ReturnType<typeof usePlugin>
  return <PluginsDialog context={context} plugins={plugins} />
}

type Act = Parameters<typeof renderComponent>[0]["act"]

function Probe(props: { open: () => JSX.Element; mcp: boolean }) {
  const data = useData()
  const dialog = useDialog()
  onMount(() => {
    // The TUI reads the MCP list with the location at startup; the Rust dialog reads it when the store has none.
    if (props.mcp) void data.location.mcp.server.sync().then(() => dialog.replace(props.open))
    else dialog.replace(props.open)
  })
  return null
}

async function render(
  fixture: string,
  open: () => JSX.Element,
  ready: (frame: string) => boolean,
  options: { act?: Act; mcp?: boolean; width?: number; height?: number } = {},
) {
  await renderComponent({
    fixture,
    width: options.width ?? 80,
    height: options.height ?? 30,
    bare: () => (
      <TestTuiContexts directory={directory}>
        <ConfigProvider config={createTuiResolvedConfig(withNewDesigns({ animations: false }))}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "home" }}>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={directory}>
                    <LocationProvider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <DialogProvider>
                          <Probe open={open} mcp={options.mcp ?? false} />
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
    ready,
    act: options.act,
  })
}

// Themes: one move previews the next theme, so the dialog draws in it.
const themes = () => <DialogThemeList />
const esc = (f: string) => f.includes("esc")
await render("E.18b/themes", themes, esc)
await render("E.18b/themes-down", themes, esc, { act: (setup) => setup.mockInput.pressArrow("down") })
await render("E.18b/themes-filter", themes, esc, { act: (setup) => setup.mockInput.typeText("tokyo") })

// Status.
const status = () => <DialogStatus />
await render("E.18b/status", status, (f) => f.includes("MCP servers"), { mcp: true })
servers = []
await render("E.18b/status-empty", status, (f) => f.includes("No MCP servers"), { mcp: true })
servers = SERVERS

// Pair: side by side from 96 columns and 36 rows, else stacked in a scroll box.
const pair = () => <DialogPair />
const paired = (f: string) => f.includes("expire in")
await render("E.18b/pair", pair, paired, { width: 100, height: 40 })
await render("E.18b/pair-narrow", pair, paired, { width: 80, height: 30 })
pairFails = true
await render("E.18b/pair-error", pair, (f) => f.includes("Could not load"), { width: 100, height: 40 })
pairFails = false

// Highlights: code spans stand out; a long list scrolls inside the band.
const HIGHLIGHTS = [
  { title: "Session tabs", body: "Open sessions side by side and switch with `ctrl+tab`." },
  { title: "Faster startup", body: "The TUI connects to the background service before it draws the first frame." },
  { title: "Pair devices", body: "Run `/pair` to open this session on your phone, or scan the code." },
]
const MORE = [...HIGHLIGHTS, ...HIGHLIGHTS.map((item) => ({ ...item, title: `${item.title} again` }))]
const whatsNew = (f: string) => f.includes("What's new")
await render("E.18b/highlights", () => <DialogHighlights version="2.0.27" items={HIGHLIGHTS} />, whatsNew)
await render("E.18b/highlights-scroll", () => <DialogHighlights version="2.0.27" items={MORE} />, whatsNew, {
  height: 20,
  act: async (setup) => {
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
  },
})

// Update: one fixture per state the dialog shows.
type UpdateState = Parameters<typeof DialogUpdate>[0]["state"] extends () => infer S ? S : never
const update = (state: UpdateState, check?: (signal: AbortSignal) => Promise<string | undefined>) => () => (
  <DialogUpdate check={check} state={() => state} skip={() => {}} install={async () => {}} restart={() => {}} />
)
const updated = (f: string) => f.includes("Update") || f.includes("Updating")
await render("E.18b/update-available", update({ type: "available", version: "2.0.28" }), updated)
await render("E.18b/update-installing", update({ type: "installing", version: "2.0.28" }), updated)
await render("E.18b/update-installed", update({ type: "installed", version: "2.0.28" }), updated)
await render("E.18b/update-failed", update({ type: "failed", message: "npm exited with code 1" }), updated)
await render("E.18b/update-current", update(undefined), updated)
await render(
  "E.18b/update-unavailable",
  update(undefined, async () => "OpenCode was installed with Homebrew. Run `brew upgrade opencode` to update."),
  (f) => f.includes("Homebrew"),
)
await render(
  "E.18b/update-checking",
  update(undefined, () => new Promise(() => {})),
  (f) => f.includes("Checking"),
)

// Plugins: TUI rows first, then the server rows; built-ins show after ctrl+a.
const plugins = () => <Plugins />
const listed = (f: string) => f.includes("team.plugins")
const large = { width: 100, height: 30 }
await render("E.18b/plugins", plugins, listed, large)
// Tall enough that the grown list needs no scroll: a Rust scroll right after the rows grow ends at the bottom
// (follow-up in steps/rs-tui-system.md).
await render("E.18b/plugins-internal", plugins, (f) => listed(f) || f.includes("hide internal"), {
  ...large,
  height: 60,
  act: async (setup) => {
    setup.mockInput.pressKey("a", { ctrl: true })
    await Bun.sleep(50)
  },
})
await render("E.18b/plugins-failed", plugins, listed, {
  ...large,
  act: async (setup) => {
    setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
  },
})
await render("E.18b/plugins-outdated", plugins, listed, {
  ...large,
  act: async (setup) => {
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
  },
})
await render("E.18b/plugins-error", plugins, (f) => listed(f) || f.includes("plugin error"), {
  ...large,
  act: async (setup) => {
    setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
})
