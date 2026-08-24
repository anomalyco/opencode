/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogMcp } from "../../../src/component/dialog-mcp"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
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

async function renderMcp() {
  const events = createEventStream()
  let oauth = 0
  let connect = 0
  const calls = createFetch((url, request) => {
    const location = {
      directory: process.cwd(),
      project: { id: "proj_test", directory: process.cwd(), canonical: process.cwd() },
    }
    if (url.pathname === "/api/mcp")
      return json({
        location,
        data: [{ name: "linear", status: { status: "needs_auth" }, integrationID: "mcp_linear" }],
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
    onMount(() => {
      void Promise.all([data.location.mcp.server.sync(), data.location.integration.sync()]).then(() =>
        dialog.replace(() => <DialogMcp />),
      )
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
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
    get oauth() {
      return oauth
    },
    get connect() {
      return connect
    },
  }
}
