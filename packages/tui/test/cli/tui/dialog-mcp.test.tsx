/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogMcp } from "../../../src/component/dialog-mcp"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each(["enter", "space"])("starts OAuth with %s for an MCP server requiring authentication", async (key) => {
  const fixture = await renderMcp()

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Sign in required"))
    if (key === "enter") fixture.app.mockInput.pressEnter()
    else fixture.app.mockInput.pressKey(" ")
    await fixture.app.waitForFrame((frame) => frame.includes("Waiting for authorization"))

    expect(fixture.oauth).toBe(1)
    expect(fixture.connect).toBe(0)
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("opens an investigation draft for a failed MCP server at its originating location", async () => {
  const location = { directory: "/projects/example", workspaceID: "workspace_example" }
  const fixture = await renderMcp({ failed: true, location })

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Failed !"))
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("i investigate"))
    fixture.app.mockInput.pressKey("i")
    await fixture.app.waitForFrame((frame) => !frame.includes("MCP server: linear"))

    expect(fixture.route.data.type).toBe("home")
    if (fixture.route.data.type !== "home") throw new Error("Expected investigation to open a new session")
    expect(fixture.route.data.location).toEqual(location)
    expect(fixture.route.data.prompt?.text).toContain("OpenCode component failed in the current project")
    expect(fixture.route.data.prompt?.text).toContain("MCP server: linear")
    expect(fixture.route.data.prompt?.text).toContain("Status: failed")
    expect(fixture.route.data.prompt?.text).toContain("Configuration: mcp.servers.linear")
    expect(fixture.route.data.prompt?.text).toContain("Integration: mcp_linear")
    expect(fixture.route.data.prompt?.text).toContain("MCP error -32000: Connection closed")
    expect(fixture.route.data.prompt?.text).toContain("project and global OpenCode configuration")
    expect(fixture.route.data.prompt?.text).not.toContain(location.directory)
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderMcp(options?: { failed?: boolean; location?: { directory: string; workspaceID?: string } }) {
  const events = createEventStream()
  let oauth = 0
  let connect = 0
  let route!: ReturnType<typeof useRoute>
  const calls = createFetch((url, request) => {
    const location = {
      ...(options?.location ?? { directory: process.cwd() }),
      project: { id: "proj_test", directory: process.cwd(), canonical: process.cwd() },
    }
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/mcp")
      return json({
        location,
        data: [
          {
            name: "linear",
            status: options?.failed
              ? { status: "failed", error: "MCP error -32000: Connection closed" }
              : { status: "needs_auth" },
            integrationID: "mcp_linear",
          },
        ],
      })
    if (url.pathname === "/api/integration")
      return json({
        location,
        data: [
          {
            id: "mcp_linear",
            name: "linear",
            methods: [{ type: "oauth", id: "mcp_linear", label: "linear" }],
            connections: [],
          },
        ],
      })
    if (url.pathname === "/api/integration/mcp_linear/connect/oauth" && request.method === "POST") {
      oauth++
      return json({
        location,
        data: {
          attemptID: "attempt_linear",
          mode: "auto",
          url: "https://linear.example.com/oauth",
          instructions: "Authorize linear in your browser.",
        },
      })
    }
    if (url.pathname === "/api/integration/mcp_linear/connect/oauth/attempt_linear") {
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      return json({ location, data: { status: "pending" } })
    }
    if (url.pathname === "/api/mcp/linear/connect" && request.method === "POST") {
      connect++
      return new Response(null, { status: 204 })
    }
    return undefined
  }, events)

  function Probe() {
    const data = useData()
    const dialog = useDialog()
    const location = useLocation()
    route = useRoute()
    onMount(() => {
      if (options?.location) location.set(options.location)
      void Promise.all([
        data.location.mcp.server.sync(options?.location),
        data.location.integration.sync(options?.location),
      ]).then(() => dialog.replace(() => <DialogMcp />))
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "session", sessionID: "ses_existing" }}>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider>
                    <LocationProvider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <DialogProvider>
                          <Probe />
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
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  return {
    app,
    get route() {
      return route
    },
    get oauth() {
      return oauth
    },
    get connect() {
      return connect
    },
  }
}
