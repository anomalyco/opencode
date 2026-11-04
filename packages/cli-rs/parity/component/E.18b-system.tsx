/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the system dialogs (E.18b): crates/tui/tests/system.rs opens the Rust dialogs over the whole
// TUI with the same responses (keep `SERVERS` and the other data below in step with it) and compares the dialog
// panel.
import { onMount, type JSX } from "solid-js"
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

const calls = createFetch((url) => {
  if (url.pathname === "/api/location") return json(location)
  if (url.pathname === "/api/mcp") return json({ location, data: servers })
  return undefined
}, createEventStream())

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
