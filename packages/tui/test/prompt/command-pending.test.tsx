/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, Show, type Setter } from "solid-js"
import { Prompt, type PromptRef } from "../../src/component/prompt"
import { TuiConfigProvider } from "../../src/config/v1"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider, useData } from "../../src/context/data"
import { EditorContextProvider } from "../../src/context/editor"
import { ExitProvider } from "../../src/context/exit"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { PromptRefProvider, usePromptRef } from "../../src/context/prompt"
import { ProjectProvider } from "../../src/context/project"
import { RouteProvider } from "../../src/context/route"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { FrecencyProvider } from "../../src/prompt/frecency"
import { PromptHistoryProvider } from "../../src/prompt/history"
import { PromptStashProvider } from "../../src/prompt/stash"
import { DialogProvider } from "../../src/ui/dialog"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createApi, createClient, createEventStream, createFetch, directory, json } from "../fixture/tui-sdk"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function setupTracker() {
  let prompt!: ReturnType<typeof usePromptRef>
  let setMounted!: Setter<boolean>

  function Status() {
    prompt = usePromptRef()
    return (
      <Show when={prompt.command.pending}>
        <text>Resolving command...</text>
      </Show>
    )
  }

  function View() {
    const [mounted, set] = createSignal(true)
    setMounted = set
    return (
      <box>
        <Show when={mounted()}>
          <Status />
        </Show>
      </box>
    )
  }

  const app = await testRender(() => (
    <PromptRefProvider>
      <View />
    </PromptRefProvider>
  ))
  await app.renderOnce()
  return { app, prompt, setMounted }
}

async function mountPrompt(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Promise.all([Bun.write(path.join(state, "kv.json"), "{}"), Bun.write(path.join(state, "model.json"), "{}")])

  const requests: {
    body: unknown
    response: ReturnType<typeof deferred<Response>>
  }[] = []
  const events = createEventStream()
  const location = { directory, project: { id: "proj_test", directory: "/tmp/opencode" } }
  const transport = createFetch(async (url, request) => {
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [
          {
            id: "build",
            name: "Build",
            request: { headers: {}, body: {} },
            mode: "primary",
            hidden: false,
            permissions: [],
          },
        ],
      })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [
          {
            id: "model",
            modelID: "model",
            providerID: "provider",
            name: "Test Model",
            capabilities: {},
            variants: [],
            time: { released: 0 },
            cost: [],
            status: "active",
            enabled: true,
            limit: { context: 10_000, output: 1_000 },
          },
        ],
      })
    if (url.pathname === "/api/command")
      return json({
        location,
        data: [{ name: "slow", template: "", description: "Slow command" }],
      })
    if (url.pathname === "/api/session/ses_test/command") {
      const response = deferred<Response>()
      requests.push({ body: await request.json(), response })
      return response.promise
    }
    return undefined
  }, events)
  const config = createTuiResolvedConfig()
  let prompt: PromptRef | undefined
  let data: ReturnType<typeof useData> | undefined

  function Content() {
    data = useData()
    return (
      <box width="100%" flexDirection="column">
        <Prompt
          sessionID="ses_test"
          ref={(value) => {
            if (value) prompt = value
          }}
        />
        <Toast />
      </box>
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={directory} paths={{ home: root, state, worktree: "/tmp/opencode" }}>
        <ExitProvider exit={() => {}}>
          <ClipboardProvider value={{}}>
            <OpencodeKeymapProvider keymap={keymap}>
              <ArgsProvider>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider initialRoute={{ type: "session", sessionID: "ses_test" }}>
                      <TuiConfigProvider config={config}>
                        <SDKProvider client={createClient(transport.fetch)} api={createApi(transport.fetch)}>
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <PromptRefProvider>
                                                <EditorContextProvider integration={{}}>
                                                  <LocationProvider location={{ directory }}>
                                                    <Content />
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
        </ExitProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 24, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame(
    (frame) =>
      frame.includes("Test Model") &&
      data?.location.command.list()?.some((command) => command.name === "slow") === true,
  )
  if (!prompt) throw new Error("expected prompt ref")
  const input = app.renderer.currentFocusedEditor
  if (!(input instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")
  return { app, input, prompt, requests }
}

function commandResponse(index: number) {
  return json({
    data: {
      admittedSeq: index,
      id: `msg_${index}`,
      sessionID: "ses_test",
      timeCreated: index,
      type: "user",
      data: { text: "Resolved command" },
      delivery: "steer",
    },
  })
}

test("shows pending before a deferred command resolves across prompt remounts", async () => {
  const { app, prompt, setMounted } = await setupTracker()
  const request = deferred<void>()
  const tracked = prompt.command.track(() => request.promise)

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Resolving command...")

    setMounted(false)
    await app.renderOnce()
    setMounted(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Resolving command...")

    request.resolve(undefined)
    await tracked
  } finally {
    app.renderer.destroy()
  }
})

test("submits through the command endpoint, clears input, and settles pending on success", async () => {
  await using tmp = await tmpdir()
  const harness = await mountPrompt(tmp.path)

  try {
    harness.prompt.set({ text: "/slow first argument", files: [], agents: [], pasted: [] })
    expect(harness.input.plainText).toBe("/slow first argument")
    harness.prompt.submit()
    expect(harness.prompt.current.text).toBe("")
    expect(harness.input.plainText).toBe("")

    await harness.app.waitFor(() => harness.requests.length === 1)
    expect(harness.requests[0]?.body).toMatchObject({
      command: "slow",
      arguments: "first argument",
      agent: "build",
      model: { providerID: "provider", id: "model" },
    })
    await harness.app.waitForFrame((frame) => frame.includes("Resolving command..."))

    harness.requests[0]?.response.resolve(commandResponse(1))
    await harness.app.waitForFrame((frame) => !frame.includes("Resolving command..."))
  } finally {
    harness.app.renderer.destroy()
  }
})

test("clears pending and preserves the command error toast on rejection", async () => {
  await using tmp = await tmpdir()
  const harness = await mountPrompt(tmp.path)

  try {
    harness.prompt.set({ text: "/slow rejected", files: [], agents: [], pasted: [] })
    harness.prompt.submit()
    await harness.app.waitFor(() => harness.requests.length === 1)
    await harness.app.waitForFrame((frame) => frame.includes("Resolving command..."))

    harness.requests[0]?.response.reject(new Error("command failed"))
    await harness.app.waitForFrame(
      (frame) => frame.includes("Failed to run command") && !frame.includes("Resolving command..."),
    )
  } finally {
    harness.app.renderer.destroy()
  }
})

test("keeps the real pending UI visible until overlapping command requests settle", async () => {
  await using tmp = await tmpdir()
  const harness = await mountPrompt(tmp.path)

  try {
    harness.prompt.set({ text: "/slow first", files: [], agents: [], pasted: [] })
    harness.prompt.submit()
    expect(harness.prompt.current.text).toBe("")
    await harness.app.waitFor(() => harness.requests.length === 1)

    harness.prompt.set({ text: "/slow second", files: [], agents: [], pasted: [] })
    harness.prompt.submit()
    expect(harness.prompt.current.text).toBe("")
    await harness.app.waitFor(() => harness.requests.length === 2)
    await harness.app.waitForFrame((frame) => frame.includes("Resolving command..."))

    harness.requests[0]?.response.resolve(commandResponse(1))
    await harness.requests[0]?.response.promise
    await Bun.sleep(10)
    expect(harness.app.captureCharFrame()).toContain("Resolving command...")

    harness.requests[1]?.response.resolve(commandResponse(2))
    await harness.app.waitForFrame((frame) => !frame.includes("Resolving command..."))
  } finally {
    harness.app.renderer.destroy()
  }
})
