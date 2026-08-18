/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../src/context/args"
import { ClipboardProvider } from "../../../src/context/clipboard"
import { EditorContextProvider } from "../../../src/context/editor"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { PromptRefProvider } from "../../../src/context/prompt"
import { RouteProvider } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../src/context/sync"
import { DataProvider } from "../../../src/context/data"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { PromptHistoryProvider } from "../../../src/component/prompt/history"
import { PromptStashProvider } from "../../../src/component/prompt/stash"
import { FrecencyProvider } from "../../../src/component/prompt/frecency"
import { Prompt } from "../../../src/component/prompt"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { tmpdir } from "../../fixture/fixture"

// Reproduces the operator-reported "session resets to the default model on
// restart" bug. `Prompt`'s hydration effect (index.tsx) sets its
// `syncedSessionID` guard BEFORE checking whether the agent list / provider
// catalog have loaded. If the session and its last user message become
// available (via sync.session.sync) before /agent and /config/providers
// resolve, both `local.agent.set` and `local.model.set` silently no-op on
// stale empty data, the guard is already latched, and the effect never
// retries once the real data arrives.
const sessionID = "ses_race"
const messageID = "msg_race"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("session model hydration survives agents/providers loading after the session's messages", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const events = createEventSource()
  let resolveAgents!: (response: Response) => void
  const agents = new Promise<Response>((resolve) => {
    resolveAgents = resolve
  })
  let agentsRequested = false

  const calls = createFetch((url) => {
    if (url.pathname === "/agent") {
      agentsRequested = true
      return agents
    }
    if (url.pathname === "/config") return json({ model: "alpha/model-a" })
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "repro",
            name: "Repro",
            source: "config",
            env: [],
            options: {},
            models: {
              beta: {
                id: "beta",
                providerID: "repro",
                api: { id: "beta", url: "", npm: "" },
                name: "Beta",
                capabilities: {
                  temperature: true,
                  reasoning: false,
                  attachment: false,
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 100000, output: 4096 },
                status: "active",
                options: {},
                headers: {},
                release_date: "2026-01-01",
              },
            },
          },
          {
            id: "alpha",
            name: "Alpha",
            source: "config",
            env: [],
            options: {},
            models: {
              "model-a": {
                id: "model-a",
                providerID: "alpha",
                api: { id: "model-a", url: "", npm: "" },
                name: "Model A",
                capabilities: {
                  temperature: true,
                  reasoning: false,
                  attachment: false,
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 100000, output: 4096 },
                status: "active",
                options: {},
                headers: {},
                release_date: "2026-01-01",
              },
            },
          },
        ],
        default: { repro: "beta", alpha: "model-a" },
      })
    if (url.pathname === "/project/proj_test/directories") return json([])
    if (url.pathname === `/session/${sessionID}`)
      return json({
        id: sessionID,
        title: "race",
        time: { created: 0, updated: 0 },
        version: "1.15.13",
        directory,
      })
    if (url.pathname === `/session/${sessionID}/message`)
      return json([
        {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: 0 },
            agent: "build",
            model: { providerID: "repro", modelID: "beta" },
          },
          parts: [],
        },
      ])
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, events)

  let local!: ReturnType<typeof useLocal>
  let sync!: ReturnType<typeof useSync>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    local = useLocal()
    sync = useSync()
    onMount(ready)
    return (
      <Prompt sessionID={sessionID} />
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig()
    registerOpencodeKeymap(keymap, renderer, resolvedConfig)

    return (
      <TuiPathsProvider value={{ cwd: directory, home: "/tmp/opencode/home", state: tmp.path, worktree: "/tmp/opencode" }}>
      <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
      <TuiStartupProvider value={{ skipInitialLoading: true }}>
        <ClipboardProvider>
          <OpencodeKeymapProvider keymap={keymap}>
            <ArgsProvider>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <TuiConfigProvider config={resolvedConfig}>
                      <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                        <PermissionProvider>
                          <ProjectProvider>
                            <ExitProvider exit={() => {}}>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <PromptRefProvider>
                                                <EditorContextProvider>
                                                  <LocationProvider>
                                                    <Probe />
                                                  </LocationProvider>
                                                </EditorContextProvider>
                                              </PromptRefProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </DialogProvider>
                                      </PromptStashProvider>
                                    </LocalProvider>
                                  </ThemeProvider>
                                </DataProvider>
                              </SyncProvider>
                            </ExitProvider>
                          </ProjectProvider>
                        </PermissionProvider>
                      </SDKProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </OpencodeKeymapProvider>
        </ClipboardProvider>
      </TuiStartupProvider>
      </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    )
  }

  const app = await testRender(() => <Harness />)

  try {
    await mounted
    await Bun.sleep(100)
    expect(agentsRequested).toBe(true)

    // Session + its last user message hydrate first, well before /agent resolves.
    await sync.session.sync(sessionID)
    await Bun.sleep(100)
    expect(sync.data.message[sessionID]?.some((m) => m.role === "user")).toBe(true)
    // The first effect run sees the message while bootstrap is still loading:
    // the empty primary-agent list triggers bail #1 before model validation.
    expect(local.agent.list()).toEqual([])
    expect(sync.data.provider).toEqual([])

    // Only now do agents/providers resolve — after the hydration effect already ran and bailed.
    resolveAgents(
      json([
        {
          name: "build",
          mode: "primary",
          permission: [],
          options: {},
        },
      ]),
    )
    await Bun.sleep(100)
    expect(sync.data.agent.length).toBeGreaterThan(0)
    expect(sync.data.provider.length).toBeGreaterThan(0)

    // Give the hydration effect a chance to react to the now-loaded agent/provider data.
    await Bun.sleep(50)

    expect(local.model.current()).toMatchObject({ providerID: "repro", modelID: "beta" })
  } finally {
    app.renderer.destroy()
  }
})
