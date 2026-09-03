/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import path from "node:path"
import { ConfigProvider } from "../../src/config"
import { ArgsProvider } from "../../src/context/args"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { LocalProvider, useLocal } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { catalogModel, catalogProvider } from "../mini/fixture/catalog"

test.each([
  { name: "agent low over saved medium", configured: "low", saved: "medium", expected: "low" },
  { name: "agent low without saved preference", configured: "low", saved: undefined, expected: "low" },
  { name: "saved medium without agent variant", configured: undefined, saved: "medium", expected: "medium" },
  { name: "agent default over saved medium", configured: "default", saved: "medium", expected: undefined },
  {
    name: "existing session retains explicit high",
    configured: "low",
    saved: "medium",
    expected: "high",
    session: true,
  },
])("variant selection: $name", async ({ configured, saved, expected, session }) => {
  const temporary = await tmpdir()
  await Bun.write(
    path.join(temporary.path, "model.json"),
    JSON.stringify({
      recent: [],
      favorite: [],
      variant: { "xai/grok-4.6": saved, "xai/other": "high" },
    }),
  )
  const events = createEventStream()
  const agent = { id: "build", mode: "primary", model: { providerID: "xai", id: "grok-4.6", variant: configured } }
  const plan = { ...agent, id: "plan", model: { ...agent.model, variant: "high" } }
  const model = catalogModel({ id: "grok-4.6", providerID: "xai", variants: ["low", "medium", "high", "xhigh"] })
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/agent") return json({ location, data: [agent, plan] })
    if (url.pathname === "/api/model")
      return json({ location, data: [model, { ...model, id: "other" }, { ...model, id: "plain" }] })
    if (url.pathname === "/api/provider") return json({ location, data: [catalogProvider("xai", "xAI")] })
  }, events)
  let local!: ReturnType<typeof useLocal>
  let storage!: ReturnType<typeof useStorage>
  let data!: ReturnType<typeof useData>
  let route!: ReturnType<typeof useRoute>
  function Probe() {
    local = useLocal()
    storage = useStorage()
    data = useData()
    route = useRoute()
    return (
      <text>
        {local.model.ready && local.model.catalogReady && local.agent.current()
          ? `ready ${JSON.stringify(local.model.selection())}`
          : "loading"}
      </text>
    )
  }
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={createTuiResolvedConfig()}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "home" }}>
                      <ClientProvider api={createApi(calls.fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={directory}>
                            <LocationProvider>
                              <ThemeProvider mode="dark" source={emptyThemeSource}>
                                <LocalProvider>
                                  <Probe />
                                </LocalProvider>
                              </ThemeProvider>
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
    { width: 120, height: 10 },
  )
  app.renderer.start()
  try {
    await app.waitForFrame((frame) => frame.includes("loading") || frame.includes("ready"))
    await data.location.sync()
    await app.waitForFrame((frame) => frame.includes("ready"))
    if (session) {
      data.session.remember({
        id: "ses_variant",
        projectID: "proj_test",
        location: { directory },
        agent: "build",
        model: { providerID: "xai", id: "grok-4.6", variant: "high" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
      })
      route.navigate({ type: "session", sessionID: "ses_variant" })
    }
    expect(local.agent.current()?.model?.variant).toBe(configured)
    expect(local.model.selection()).toEqual({ providerID: "xai", modelID: "grok-4.6", variant: expected })
    local.model.set({ providerID: "xai", modelID: "grok-4.6" })
    expect(local.model.selection()?.variant).toBe(expected)
    local.model.variant.set("high")
    expect(local.model.variant.current()).toBe("high")
    local.model.variant.set(undefined)
    expect(local.model.selection()?.variant).toBeUndefined()
    local.model.variant.cycle()
    expect(local.model.variant.current()).toBe("low")
    if (!session) {
      local.model.variant.set(undefined)
      local.agent.set("plan")
      expect(local.model.variant.current()).toBe("high")
      local.model.variant.set("xhigh")
      local.agent.set("build")
      expect(local.model.selection()?.variant).toBeUndefined()
    }
    local.model.set({ providerID: "xai", modelID: "other" })
    expect(local.model.variant.current()).toBe("high")
    local.model.variant.set(undefined)
    local.model.set({ providerID: "xai", modelID: "plain" })
    expect(local.model.selection()?.variant).toBeUndefined()
    local.model.set({ providerID: "xai", modelID: "other" })
    expect(local.model.selection()?.variant).toBeUndefined()
  } finally {
    app.renderer.destroy()
    await storage?.flush()
    await temporary[Symbol.asyncDispose]()
  }
})
