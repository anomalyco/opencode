/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the MCP servers dialog (packages/tui/src/component/dialog-mcp.tsx) and the skills
// dialog (component/dialog-skill.tsx). crates/tui/tests/all/mcp.rs mounts the Rust TUI over the same responses
// (`SERVERS` and `SKILLS` below; keep both in step), hides the screen behind the dialog, sends the same keys,
// and compares the cells.
import { onMount, type JSX } from "solid-js"
import { DialogMcp } from "../../../tui/src/component/dialog-mcp"
import { DialogSkill } from "../../../tui/src/component/dialog-skill"
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

const SKILL = (id: string, description?: string) => ({
  id,
  name: id,
  ...(description === undefined ? {} : { description }),
  path: `/tmp/opencode/skills/${id}/SKILL.md`,
  content: "",
})
const SKILLS = [
  SKILL("review", "Review a change\n  for defects  and style."),
  SKILL("release-notes", "Write release notes from the log."),
  SKILL("bisect"),
]

let skills: unknown[] = SKILLS

const calls = createFetch((url) => {
  if (url.pathname === "/api/location") return json(location)
  if (url.pathname === "/api/mcp") return json({ location, data: SERVERS })
  if (url.pathname === "/api/skill") return json({ location, data: skills })
  return undefined
}, createEventStream())

function Probe(props: { open: () => JSX.Element; mcp: boolean }) {
  const data = useData()
  const dialog = useDialog()
  onMount(() => {
    // The TUI reads the MCP list with the location; the Rust dialog reads it when the store has none.
    if (props.mcp) void data.location.mcp.server.sync().then(() => dialog.replace(props.open))
    else dialog.replace(props.open)
  })
  return null
}

type Act = Parameters<typeof renderComponent>[0]["act"]

async function render(fixture: string, open: () => JSX.Element, ready: (frame: string) => boolean, act?: Act) {
  await renderComponent({
    fixture,
    width: 100,
    height: 30,
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
                          <Probe open={open} mcp={fixture.includes("mcp")} />
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
    act,
  })
}

const mcp = () => <DialogMcp />
await render("E.17b/mcp", mcp, (frame) => frame.includes("Sign in required"))
await render(
  "E.17b/mcp-failed",
  mcp,
  (frame) => frame.includes("Sign in required"),
  async (setup) => {
    // Sorted by name: docs, figma, github, linear.
    for (let index = 0; index < 3; index++) setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
  },
)
await render(
  "E.17b/mcp-error",
  mcp,
  (frame) => frame.includes("MCP servers") || frame.includes("MCP server: linear"),
  async (setup) => {
    for (let index = 0; index < 3; index++) setup.mockInput.pressArrow("down")
    await Bun.sleep(50)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
)

const skill = () => <DialogSkill onSelect={() => {}} />
const listed = (frame: string) => frame.includes("Skills") && !frame.includes("Loading")
await render("E.17b/skills", skill, (frame) => listed(frame) && frame.includes("bisect"))
await render("E.17b/skills-filter", skill, listed, async (setup) => {
  await setup.mockInput.typeText("rel")
  await Bun.sleep(50)
})
skills = []
await render("E.17b/skills-empty", skill, (frame) => listed(frame) && frame.includes("No skills"))
