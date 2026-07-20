/** @jsxImportSource @opentui/solid */
import { Renderable, TextRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, type Setter } from "solid-js"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, json } from "./fixture/tui-sdk"
import { TestTuiContexts } from "./fixture/tui-environment"
import { tmpdir } from "./fixture/fixture"
import { ArgsProvider } from "../src/context/args"
import { ClipboardProvider } from "../src/context/clipboard"
import { DataProvider } from "../src/context/data"
import { EditorContextProvider } from "../src/context/editor"
import { ExitProvider } from "../src/context/exit"
import { KVProvider } from "../src/context/kv"
import { LocalProvider, useLocal } from "../src/context/local"
import { LocationProvider } from "../src/context/location"
import { PermissionProvider } from "../src/context/permission"
import { ProjectProvider } from "../src/context/project"
import { RouteProvider } from "../src/context/route"
import { SDKProvider } from "../src/context/sdk"
import { SyncProvider, useSync } from "../src/context/sync"
import { ThemeProvider } from "../src/context/theme"
import { TuiConfigProvider } from "../src/config"
import { DialogModel } from "../src/component/dialog-model"
import { Prompt, type PromptRef } from "../src/component/prompt"
import { FrecencyProvider } from "../src/prompt/frecency"
import { PromptHistoryProvider } from "../src/prompt/history"
import { PromptStashProvider } from "../src/prompt/stash"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"
import { DialogProvider } from "../src/ui/dialog"
import { DialogSelect } from "../src/ui/dialog-select"
import { ToastProvider } from "../src/ui/toast"

type Subject =
  | "prompt"
  | "prompt-model"
  | "local"
  | "local-model"
  | "dialog-model"
  | "dialog-select"

function deferredValue<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountLoadingGate(root: string, subject: Subject) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  if (subject === "prompt-model")
    await Bun.write(
      path.join(state, "model.json"),
      JSON.stringify({
        recent: [{ providerID: "cached", modelID: "model" }],
        labels: { "cached/model": { providerName: "Cached", modelName: "Model" } },
      }),
    )

  const agents = deferredValue<unknown>()
  const catalog = deferredValue<unknown>()
  const commands = deferredValue<unknown>()
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (subject === "prompt-model" && url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: {}, options: {} }])
    if (url.pathname === "/agent") return agents.promise.then((value) => json(value))
    if (subject === "local-model" && url.pathname === "/command") return commands.promise.then((value) => json(value))
    if (subject === "local-model" && url.pathname === "/config") return json({ model: "cached/model" })
    if ((subject === "prompt-model" || subject === "dialog-model") && url.pathname === "/config/providers")
      return catalog.promise.then((value) => json(value))
  })
  const config = createTuiResolvedConfig()
  let keymap!: ReturnType<typeof createDefaultOpenTuiKeymap>
  let local!: ReturnType<typeof useLocal>
  let sync!: ReturnType<typeof useSync>
  let prompt: PromptRef | undefined
  let setDisabled!: Setter<boolean>
  let emptySubmitCalls = 0

  function SubjectView(props: { disabled: boolean }) {
    local = useLocal()
    sync = useSync()
    if (subject === "prompt" || subject === "prompt-model")
      return <Prompt disabled={props.disabled} ref={(value) => (prompt = value)} />
    if (subject === "dialog-model") return <DialogModel />
    if (subject === "dialog-select") {
      return (
        <DialogSelect<string>
          title="Empty selection"
          options={[]}
          onEmptySubmit={() => {
            emptySubmitCalls++
          }}
        />
      )
    }
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)
    const [disabled, updateDisabled] = createSignal(false)
    setDisabled = updateDisabled

    return (
      <TestTuiContexts
        directory={root}
        skipInitialLoading={true}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
      >
        <ExitProvider exit={() => {}}>
          <ClipboardProvider value={{}}>
            <OpencodeKeymapProvider keymap={keymap}>
              <ArgsProvider>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <TuiConfigProvider config={config}>
                        <SDKProvider url="http://test" directory={root} fetch={calls.fetch} events={events.source}>
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <EditorContextProvider integration={{}}>
                                                <LocationProvider location={{ directory: root }}>
                                                  <SubjectView disabled={disabled()} />
                                                </LocationProvider>
                                              </EditorContextProvider>
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

  const app = await testRender(() => <Harness />, { width: 100, height: 30 })
  await waitFor(() => local !== undefined && sync !== undefined)

  return {
    app,
    keymap,
    local,
    sync,
    prompt: () => prompt,
    setDisabled,
    emptySubmitCalls: () => emptySubmitCalls,
    sessionRequests: calls.session,
    async cleanup() {
      agents.resolve([])
      catalog.resolve({ providers: {}, default: {} })
      commands.resolve([])
      app.renderer.destroy()
    },
  }
}

function findText(root: Renderable, text: string): TextRenderable | undefined {
  if (root instanceof TextRenderable && root.plainText === text) return root
  return root.getChildren().map((child) => findText(child, text)).find(Boolean)
}

function attentionWrapper(root: Renderable) {
  let current = findText(root, "Loading")?.parent
  while (current && current.left === undefined) current = current.parent
  if (!current) throw new Error("loading attention wrapper not found")
  return current
}

test("real Prompt submission remains blocked until agents settle", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "prompt")

  try {
    await waitFor(() => mounted.sync.status !== "loading" && mounted.sync.data.agent_status === "loading")
    await waitFor(() => mounted.prompt() !== undefined)
    const prompt = mounted.prompt()!
    const requests = mounted.sessionRequests.length

    prompt.submit()
    await Bun.sleep(0)
    expect(mounted.sessionRequests).toHaveLength(requests)

    mounted.setDisabled(true)
    prompt.set({ input: "blocked", parts: [] })
    await mounted.app.renderOnce()
    prompt.submit()
    await Bun.sleep(0)
    expect(mounted.sessionRequests).toHaveLength(requests)

    mounted.setDisabled(false)
    await mounted.app.renderOnce()
    prompt.submit()
    await Bun.sleep(0)
    expect(mounted.sessionRequests).toHaveLength(requests)
  } finally {
    await mounted.cleanup()
  }
})

test("real Prompt keeps optimistic model metadata display-only until providers settle", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "prompt-model")

  try {
    await waitFor(() => mounted.sync.data.agent_status === "complete", 2000)
    await waitFor(
      () => mounted.prompt() !== undefined && mounted.local.model.current() !== undefined,
      2000,
    )
    const prompt = mounted.prompt()!
    const requests = mounted.sessionRequests.length

    prompt.set({ input: "do not send early", parts: [] })
    prompt.submit()
    await Bun.sleep(20)
    expect(mounted.sessionRequests).toHaveLength(requests)
  } finally {
    await mounted.cleanup()
  }
})
test("real local agent movement remains a no-op while agents load", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "local")

  try {
    await waitFor(() => mounted.sync.status !== "loading" && mounted.sync.data.agent_status === "loading")
    expect(mounted.local.agent.current()).toBeUndefined()

    mounted.local.agent.move(1)
    mounted.local.agent.move(-1)

    expect(mounted.local.agent.current()).toBeUndefined()
  } finally {
    await mounted.cleanup()
  }
})

test("settled empty catalog clears the optimistic model while background work remains pending", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "local-model")

  try {
    await waitFor(() => mounted.sync.status === "partial")
    expect(mounted.local.model.current()).toBeUndefined()
    await Bun.sleep(30)
    expect(mounted.sync.status).toBe("partial")
  } finally {
    await mounted.cleanup()
  }
})

test("real DialogModel submit shakes its loading spinner", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "dialog-model")

  try {
    expect(mounted.sync.status).toBe("loading")
    await waitFor(() => findText(mounted.app.renderer.root, "Loading") !== undefined)
    await waitFor(() => mounted.keymap.getCommands().some((command) => command.name === "dialog.select.submit"))
    const wrapper = attentionWrapper(mounted.app.renderer.root)
    expect(wrapper.left).toBe(0)

    mounted.keymap.dispatchCommand("dialog.select.submit")

    expect(wrapper.left).toBe(-1)
  } finally {
    await mounted.cleanup()
  }
})

test("rendered DialogSelect dispatches empty submit through its command", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "dialog-select")

  try {
    await waitFor(() => mounted.keymap.getCommands().some((command) => command.name === "dialog.select.submit"))
    mounted.keymap.dispatchCommand("dialog.select.submit")
    expect(mounted.emptySubmitCalls()).toBe(1)
  } finally {
    await mounted.cleanup()
  }
})
