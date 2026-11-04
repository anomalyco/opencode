/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for "Connect an integration" (packages/tui/src/component/dialog-integration.tsx).
// crates/tui/tests/all/integrations.rs mounts the Rust TUI over the same responses (`INTEGRATIONS` and `ATTEMPT`
// below; keep both in step), hides the screen behind the dialog, sends the same keys, and compares the cells.
// Nothing here connects anything: the fetch handler answers every write.
import { onMount, type JSX } from "solid-js"
import { DialogIntegration } from "../../../tui/src/component/dialog-integration"
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

const credential = (id: string, label: string, status?: unknown) => ({
  type: "credential",
  id,
  label,
  method: "key",
  ...(status ? { status } : {}),
})

const INTEGRATIONS = [
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [{ type: "oauth", id: "device", label: "Sign in with OpenCode" }],
    connections: [credential("cred_work", "work"), credential("cred_home", "home")],
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      { type: "key", label: "API key" },
      { type: "oauth", id: "browser", label: "ChatGPT Plus/Pro" },
    ],
    connections: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    methods: [{ type: "key" }],
    connections: [credential("cred_ant", "personal", { status: "expired", message: "Expired" })],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    methods: [
      {
        type: "oauth",
        id: "device",
        label: "Sign in with GitHub",
        form: [
          {
            key: "deployment",
            type: "string",
            title: "Deployment",
            required: true,
            options: [
              { value: "github.com", label: "GitHub.com", description: "Public" },
              { value: "enterprise", label: "GitHub Enterprise" },
            ],
          },
        ],
      },
    ],
    connections: [],
  },
  {
    id: "acme",
    name: "Acme",
    methods: [{ type: "key" }, { type: "env", names: ["ACME_KEY"] }],
    connections: [{ type: "env", name: "ACME_KEY" }],
  },
  { id: "zed", name: "Zed", methods: [{ type: "env", names: ["ZED_KEY"] }], connections: [] },
  {
    id: "mcp_notion",
    name: "Notion",
    metadata: { source: "mcp" },
    methods: [{ type: "oauth", id: "mcp", label: "Sign in" }],
    connections: [],
  },
]

const ATTEMPT = {
  attemptID: "att_1",
  url: "https://github.com/login/device",
  instructions: "Enter code ABCD-1234",
  mode: "auto",
  time: { created: 1, expires: 2 },
}

const calls = createFetch((url, request) => {
  if (url.pathname === "/api/location") return json(location)
  if (url.pathname === "/api/integration") return json({ location, data: INTEGRATIONS })
  if (url.pathname === "/api/model") return json({ location, data: [] })
  if (url.pathname === "/api/provider") return json({ location, data: [] })
  if (request.method === "DELETE") return new Response(null, { status: 204 })
  if (request.method === "POST" && url.pathname.endsWith("/connect/oauth")) return json({ location, data: ATTEMPT })
  if (url.pathname.includes("/connect/oauth/"))
    return json({ location, data: { status: "pending", time: { created: 1, expires: 2 } } })
  return undefined
}, createEventStream())

function Probe(props: { open: () => JSX.Element }) {
  const data = useData()
  const dialog = useDialog()
  onMount(() => {
    void data.location.integration.sync().then(() => dialog.replace(props.open))
  })
  return null
}

type Act = Parameters<typeof renderComponent>[0]["act"]

async function render(fixture: string, ready: (frame: string) => boolean, act?: Act) {
  await renderComponent({
    fixture,
    width: 100,
    height: 40,
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
                          <Probe open={() => <DialogIntegration />} />
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

// Sorted: OpenCode Console, OpenAI, GitHub Copilot, Anthropic (Popular); Acme, Zed (Services).
// The ready check also matches the list, which shows before `act` runs.
const listed = (frame: string) => frame.includes("Connect an integration")
const down = async (setup: Parameters<NonNullable<Act>>[0], count: number) => {
  for (let index = 0; index < count; index++) setup.mockInput.pressArrow("down")
  await Bun.sleep(50)
}

await render("E.17a/list", (frame) => listed(frame) && frame.includes("Anthropic"))
await render(
  "E.17a/list-end",
  (frame) => listed(frame) && frame.includes("Anthropic"),
  async (setup) => {
    setup.mockInput.pressArrow("up")
    await Bun.sleep(50)
  },
)
await render(
  "E.17a/accounts",
  (frame) => listed(frame) || frame.includes("Connected accounts"),
  async (setup) => {
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
)
await render(
  "E.17a/methods",
  (frame) => listed(frame) || frame.includes("Connect OpenAI"),
  async (setup) => {
    await down(setup, 1)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
)
await render(
  "E.17a/key",
  (frame) => listed(frame) || (frame.includes("API key") && !frame.includes("ChatGPT")),
  async (setup) => {
    await down(setup, 1)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
    await down(setup, 1)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
)
await render(
  "E.17a/form",
  (frame) => listed(frame) || frame.includes("Deployment"),
  async (setup) => {
    await down(setup, 2)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
  },
)
await render(
  "E.17a/oauth",
  (frame) => listed(frame) || frame.includes("Waiting for authorization"),
  async (setup) => {
    await down(setup, 2)
    setup.mockInput.pressEnter()
    await Bun.sleep(100)
    setup.mockInput.pressEnter()
    await Bun.sleep(200)
  },
)
