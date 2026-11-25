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

async function wait(fn: () => boolean, timeout = 5_000, label = "condition") {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

// A plugin configured in a project's opencode.json only reaches the TUI when the plugin
// inventory is asked about the location the TUI is routed to, not the directory the TUI
// was started in (anomalyco/opencode#65729).
async function renderPluginHost(other: string) {
  const temporary = await tmpdir()
  const finalizers = new Set<() => Promise<void>>()
  const asked: string[] = []
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/plugin") return undefined
    const location = url.searchParams.get("location[directory]") ?? directory
    asked.push(location)
    return json({
      location: { directory: location },
      // The plugin is only configured in `other`, the way a project's opencode.json holds it.
      data:
        location === other
          ? [
              {
                id: "fixture.project-plugin",
                source: { type: "local", path: path.join(other, ".opencode/plugins/example.ts") },
                features: { server: true, tui: true },
                state: { status: "active" },
              },
            ]
          : [],
    })
  }, events)

  let location!: ReturnType<typeof useLocation>
  let client!: ReturnType<typeof useClient>
  let probed = false
  let plugins!: ReturnType<typeof usePlugin>

  function Probe() {
    location = useLocation()
    client = useClient()
    plugins = usePlugin()
    probed = true
    return <box />
  }

  const setup = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <TuiLifecycleProvider
              value={{
                add(finalizer) {
                  finalizers.add(finalizer)
                  return () => finalizers.delete(finalizer)
                },
              }}
            >
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
                        <DataProvider directory={directory}>
                          <LocationProvider>
                            <PermissionProvider>
                              <LocalProvider>
                                <DialogProvider>
                                  <AttentionProvider>
                                    <SessionTabsProvider>
                                      <PluginProvider
                                        packages={{ prepare: async () => ({ directory: "" }) }}
                                        directories={[]}
                                      >
                                        <box />
                                        <Probe />
                                      </PluginProvider>
                                    </SessionTabsProvider>
                                  </AttentionProvider>
                                </DialogProvider>
                              </LocalProvider>
                            </PermissionProvider>
                          </LocationProvider>
                        </DataProvider>
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

  await wait(() => probed && client.connection.status() === "connected", 5_000, "the plugin host to render")
  return {
    setup,
    asked,
    plugins,
    setLocation: (target: string) => location.set({ directory: target }),
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("asks the plugin inventory about the routed location, not the startup directory", async () => {
  const other = path.join(directory, "other-project")
  await using host = await renderPluginHost(other)

  await wait(() => host.asked.includes(directory), 5_000, "the startup location to be asked")
  expect(host.plugins.ready()).toBe(true)

  host.setLocation(other)
  await wait(() => host.asked.includes(other), 5_000, "the routed location to be asked")
})
