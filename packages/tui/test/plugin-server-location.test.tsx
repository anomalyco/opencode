/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import path from "path"
import { ConfigProvider } from "../src/config"
import { ArgsProvider } from "../src/context/args"
import { ClientProvider, useClient } from "../src/context/client"
import { DataProvider } from "../src/context/data"
import { Keymap } from "../src/context/keymap"
import { LocalProvider } from "../src/context/local"
import { LocationProvider, useLocation } from "../src/context/location"
import { PermissionProvider } from "../src/context/permission"
import { RouteProvider } from "../src/context/route"
import { TuiAppProvider, TuiLifecycleProvider } from "../src/context/runtime"
import { SessionTabsProvider } from "../src/context/session-tabs"
import { AttentionProvider } from "../src/context/attention"
import { StorageProvider } from "../src/context/storage"
import { ThemeProvider } from "../src/context/theme"
import { DialogProvider } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { PluginProvider, usePlugin } from "../src/plugin/context"
import { tmpdir } from "./fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

// The plugin an `at` project configures in its own opencode.json (anomalyco/opencode#65729).
const projectPlugin = (at: string) => ({
  id: "fixture.project-plugin",
  source: { type: "local", path: path.join(at, ".opencode/plugins/example.ts") },
  features: { server: true, tui: true },
  state: { status: "active" },
})

async function waitFor<T>(fn: () => T | undefined, timeout: number, label: string) {
  const start = Date.now()
  for (;;) {
    const value = fn()
    if (value !== undefined) return value
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

// The stack a plugin host reads: the route, the keymap, the theme, the dialog and toast
// services, the args the permission provider needs, storage and the session tabs.
async function renderPluginHost(answer: (location: string) => unknown[]) {
  const temporary = await tmpdir()
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/plugin") return undefined
    const location = url.searchParams.get("location[directory]") ?? directory
    return json({ location: { directory: location }, data: answer(location) })
  }, events)

  let location!: ReturnType<typeof useLocation>
  let client!: ReturnType<typeof useClient>
  let plugins!: ReturnType<typeof usePlugin>

  function Probe() {
    location = useLocation()
    client = useClient()
    plugins = usePlugin()
    return <box />
  }

  const setup = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <TuiLifecycleProvider value={{ add: () => () => {} }}>
              <ArgsProvider>
                <ConfigProvider
                  config={createTuiResolvedConfig({})}
                  service={{ get: async () => ({}), update: async () => ({}) }}
                >
                  <Keymap.Provider>
                    <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                      <ToastProvider>
                        <RouteProvider initialRoute={{ type: "home" }}>
                          <ClientProvider api={createApi(calls.fetch)}>
                            <PermissionProvider>
                              <DataProvider directory={directory}>
                                <LocationProvider>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <AttentionProvider>
                                        <SessionTabsProvider>
                                          <PluginProvider
                                            packages={{ prepare: async () => ({ directory: "" }) }}
                                            directories={[]}
                                          >
                                            <Probe />
                                          </PluginProvider>
                                        </SessionTabsProvider>
                                      </AttentionProvider>
                                    </DialogProvider>
                                  </LocalProvider>
                                </LocationProvider>
                              </DataProvider>
                            </PermissionProvider>
                          </ClientProvider>
                        </RouteProvider>
                      </ToastProvider>
                    </ThemeProvider>
                  </Keymap.Provider>
                </ConfigProvider>
              </ArgsProvider>
            </TuiLifecycleProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )

  await waitFor(() => (client?.connection.status() === "connected" ? client : undefined), 5_000, "the TUI to connect")
  return {
    plugins,
    setLocation: (target: string) => location.set({ directory: target }),
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("lists a plugin only the routed project configures", async () => {
  const other = path.join(directory, "other-project")
  await using host = await renderPluginHost((location) => (location === other ? [projectPlugin(other)] : []))

  host.setLocation(other)

  const listed = await waitFor(
    () => host.plugins.server().find((plugin) => plugin.id === "fixture.project-plugin"),
    5_000,
    "the routed project's plugin to be listed",
  )
  expect(listed.id).toBe("fixture.project-plugin")
})
