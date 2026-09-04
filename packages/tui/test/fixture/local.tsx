import { testRender } from "@opentui/solid"
import type { AgentInfo, ModelInfo, SessionInfo } from "@opencode-ai/client"
import path from "node:path"
import { ConfigProvider } from "../../src/config"
import { ArgsProvider, type Args } from "../../src/context/args"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { LocalProvider, useLocal } from "../../src/context/local"
import { Keymap } from "../../src/context/keymap"
import { LocationProvider, useLocation } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { RouteProvider, useRoute } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import type { ModelPreference } from "../../src/model-preference"
import { tmpdir } from "./fixture"
import { createApi, createEventStream, createFetch, directory, json, type FetchHandler } from "./tui-client"
import { TestTuiContexts } from "./tui-environment"
import { createTuiResolvedConfig } from "./tui-runtime"

export async function renderLocal(
  input: {
    models?: ModelInfo[]
    agents?: AgentInfo[]
    sessions?: SessionInfo[]
    preferences?: Partial<ModelPreference>
    args?: Args
    fetch?: FetchHandler
    width?: number
  } = {},
) {
  const temporary = await tmpdir()
  await Bun.write(path.join(temporary.path, "model.json"), JSON.stringify(input.preferences ?? {}))
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    const response = await input.fetch?.(url, request)
    if (response) return response
    const location = { directory: url.searchParams.get("location[directory]") ?? directory }
    if (url.pathname === "/api/agent") return json({ location, data: input.agents ?? [agent("build")] })
    if (url.pathname === "/api/model") return json({ location, data: input.models ?? [model("first")] })
    const session = input.sessions?.find((session) => url.pathname === `/api/session/${session.id}`)
    if (session) return json({ data: session })
  }, events)
  let local!: ReturnType<typeof useLocal>
  let route!: ReturnType<typeof useRoute>
  let data!: ReturnType<typeof useData>
  let location!: ReturnType<typeof useLocation>
  let dialog!: ReturnType<typeof useDialog>

  function Probe() {
    local = useLocal()
    route = useRoute()
    data = useData()
    location = useLocation()
    dialog = useDialog()
    return <box />
  }

  const setup = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <ArgsProvider {...input.args}>
          <ConfigProvider config={createTuiResolvedConfig()}>
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
                                <Probe />
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
      </TestTuiContexts>
    ),
    { width: input.width ?? 100, height: 30, kittyKeyboard: true },
  )
  await setup.waitFor(() => local !== undefined && local.model.ready)
  await data.location.sync()
  return {
    ...setup,
    local,
    route,
    data,
    location,
    dialog,
    events,
    state: temporary.path,
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

export function model(id: string, variants: string[] = []): ModelInfo {
  return {
    id,
    modelID: id,
    providerID: "provider",
    name: id,
    status: "active",
    enabled: true,
    capabilities: { input: ["text"], output: ["text"], tools: true },
    cost: [],
    limit: { context: 10000, output: 1000 },
    time: { released: 0 },
    variants: variants.map((id) => ({ id })),
  }
}

export function agent(id: string, selected?: AgentInfo["model"]): AgentInfo {
  return {
    id,
    name: id,
    model: selected,
    mode: "primary",
    hidden: false,
    permissions: [],
    request: { settings: {}, headers: {}, body: {} },
  }
}

export function session(id: string, selected?: SessionInfo["model"], agent = "build"): SessionInfo {
  return {
    id,
    agent,
    model: selected,
    title: id,
    location: { directory },
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}
