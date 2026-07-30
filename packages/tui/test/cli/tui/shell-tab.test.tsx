/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createEffect } from "solid-js"
import { ClientProvider } from "../../../src/context/client"
import { ConfigProvider } from "../../../src/config"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createApi, createEventStream, createFetch, json, worktree } from "../../fixture/tui-client"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const directory = `${worktree}/packages/tui`
const sessionDirectory = `${directory}/session`

function SetLocation() {
  const location = useLocation()
  createEffect(() => location.set({ directory: sessionDirectory }))
  return null
}

test("lists running shells from the active session location", async () => {
  const events = createEventStream()
  const transport = createFetch((url) => {
    const requested = url.searchParams.get("location[directory]") ?? directory
    const location = {
      directory: requested,
      project: { id: "proj_test", directory: worktree, canonical: worktree },
    }
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/shell")
      return json({
        location,
        data:
          requested === sessionDirectory
            ? [
                {
                  id: "sh_test",
                  status: "running",
                  command: "sleep 30",
                  cwd: sessionDirectory,
                  shell: "/bin/sh",
                  file: "/tmp/sh_test.out",
                  pid: 123,
                  metadata: { sessionID: "ses_test" },
                  time: { started: 1 },
                },
              ]
            : [],
      })
  }, events)

  const app = await testRender(() => (
    <TestTuiContexts directory={directory}>
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <RouteProvider initialRoute={{ type: "session", sessionID: "ses_test" }}>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                    <SetLocation />
                    <Composer sessionID="ses_test" open={true} defaultTab="shell" />
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </RouteProvider>
        </Keymap.Provider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    app.renderer.start()
    const frame = await app.waitForFrame((value) => value.includes("sleep 30"))
    expect(frame).not.toContain("No shell commands")
  } finally {
    app.renderer.destroy()
  }
})
