/** @jsxImportSource @opentui/solid */
import { Renderable, TextRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, onCleanup, onMount, type Setter } from "solid-js"
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
import { ProjectProvider, useProject } from "../src/context/project"
import { RouteProvider } from "../src/context/route"
import { SDKProvider } from "../src/context/sdk"
import { SyncProvider, useSync } from "../src/context/sync"
import { ThemeProvider } from "../src/context/theme"
import { TuiConfigProvider } from "../src/config"
import { DialogModel } from "../src/component/dialog-model"
import { DialogWorkspaceSelect } from "../src/component/dialog-workspace-create"
import { Prompt, type PromptRef } from "../src/component/prompt"
import { FrecencyProvider } from "../src/prompt/frecency"
import { PromptHistoryProvider } from "../src/prompt/history"
import { PromptStashProvider } from "../src/prompt/stash"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { DialogSelect } from "../src/ui/dialog-select"
import { ToastProvider } from "../src/ui/toast"

type Subject =
  | "prompt"
  | "prompt-model"
  | "prompt-command"
  | "local"
  | "local-model"
  | "dialog-model"
  | "dialog-select"
  | "dialog-select-locked"
  | "sync-error"
  | "workspace-select"

function deferredValue<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean, timeout = 2000, message = "timed out waiting for condition") {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(message)
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
    if (subject === "workspace-select" && url.pathname === "/experimental/workspace")
      return json(
        ["alpha", "beta", "gamma", "delta"].map((name, index) => ({
          id: `wrk_${name}`,
          type: "worktree",
          name,
          projectID: "proj_test",
          timeUsed: 100 - index,
        })),
      )
    if (subject === "workspace-select" && url.pathname === "/experimental/workspace/status")
      return json(
        ["alpha", "beta", "gamma", "delta"].map((name) => ({
          workspaceID: `wrk_${name}`,
          status: "connected",
        })),
      )
    if (subject === "sync-error" && (url.pathname === "/command" || url.pathname === "/provider/auth"))
      return json({ message: "unavailable" }, { status: 503 })
    if ((subject === "prompt-model" || subject === "prompt-command") && url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: {}, options: {} }])
    if (url.pathname === "/agent") return agents.promise.then((value) => json(value))
    if ((subject === "local-model" || subject === "prompt-command") && url.pathname === "/command")
      return commands.promise.then((value) => json(value))
    if (subject === "local-model" && url.pathname === "/config") return json({ model: "cached/model" })
    if (subject === "prompt-command" && url.pathname === "/config") return json({ model: "test/model" })
    if (subject === "prompt-command" && url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "test",
            name: "Test",
            env: [],
            models: {
              model: {
                id: "model",
                name: "Model",
                attachment: false,
                reasoning: false,
                temperature: false,
                tool_call: true,
                release_date: "2025-01-01",
                limit: { context: 100000, output: 10000 },
                cost: { input: 0, output: 0 },
                options: {},
              },
            },
            options: {},
          },
        ],
        default: { test: "model" },
      })
    if ((subject === "prompt-model" || subject === "dialog-model") && url.pathname === "/config/providers")
      return catalog.promise.then((value) => json(value))
  })
  const config = createTuiResolvedConfig()
  let keymap!: ReturnType<typeof createDefaultOpenTuiKeymap>
  let local!: ReturnType<typeof useLocal>
  let project!: ReturnType<typeof useProject>
  let sync!: ReturnType<typeof useSync>
  let prompt: PromptRef | undefined
  let setDisabled!: Setter<boolean>
  let emptySubmitCalls = 0
  let workspaceDialogClosed = 0
  let workspaceSelect: { showAll(): void; showingAll(): boolean } | undefined

  function SubjectView(props: { disabled: boolean }) {
    local = useLocal()
    project = useProject()
    sync = useSync()
    const dialog = useDialog()
    if (subject === "prompt" || subject === "prompt-model" || subject === "prompt-command")
      return <Prompt disabled={props.disabled} ref={(value) => (prompt = value)} />
    if (subject === "dialog-model") return <DialogModel />
    if (subject === "dialog-select" || subject === "dialog-select-locked") {
      return (
        <DialogSelect<string>
          title="Empty selection"
          options={[]}
          locked={subject === "dialog-select-locked"}
          onEmptySubmit={() => {
            emptySubmitCalls++
          }}
        />
      )
    }
    if (subject === "workspace-select") {
      onMount(() => {
        dialog.replace(
          () => (
            <DialogWorkspaceSelect
              adapters={[]}
              onSelect={() => {}}
              controller={(value) => (workspaceSelect = value)}
            />
          ),
          () => workspaceDialogClosed++,
        )
      })
      return <box />
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
    project,
    sync,
    prompt: () => prompt,
    setDisabled,
    emptySubmitCalls: () => emptySubmitCalls,
    workspaceDialogClosed: () => workspaceDialogClosed,
    workspaceSelect: () => workspaceSelect,
    resolveCatalog: catalog.resolve,
    resolveCommands: commands.resolve,
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

test("real Prompt does not create a session for slash input before commands settle", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "prompt-command")

  try {
    await waitFor(() => mounted.sync.data.provider_status === "complete", 2000, "provider catalog did not settle")
    await waitFor(() => mounted.sync.data.agent_status === "complete", 2000, "agents did not settle")
    expect(mounted.sync.data.command_status).toBe("loading")
    await waitFor(
      () => mounted.prompt() !== undefined && mounted.local.model.current() !== undefined,
      2000,
      "prompt model did not settle",
    )
    const prompt = mounted.prompt()!
    const requests = mounted.sessionRequests.length

    prompt.set({ input: "/review this", parts: [] })
    prompt.submit()
    await Bun.sleep(20)
    expect(mounted.sessionRequests).toHaveLength(requests)

    mounted.resolveCommands([])
    await waitFor(() => mounted.sync.data.command_status === "complete", 2000, "commands did not settle")
    prompt.submit()
    await waitFor(() => mounted.sessionRequests.length === requests + 1, 2000, "settled slash input was not submitted")
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

test("deferred command and provider auth failures remain unavailable", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "sync-error")

  try {
    await waitFor(
      () => mounted.sync.data.command_status === "error" && mounted.sync.data.provider_auth_status === "error",
    )
    expect(mounted.sync.data.command).toEqual([])
    expect(mounted.sync.data.provider_auth).toEqual({})
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

test("real DialogModel keeps the loading label in the attention row", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "dialog-model")

  try {
    await waitFor(() => findText(mounted.app.renderer.root, "Loading") !== undefined)
    const label = findText(mounted.app.renderer.root, "Loading")!
    expect(label.parent).toBe(attentionWrapper(mounted.app.renderer.root))
  } finally {
    await mounted.cleanup()
  }
})

test("real DialogModel remains locked after providers settle while agents are loading", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "dialog-model")

  try {
    mounted.resolveCatalog({ providers: {}, default: {} })
    await waitFor(() => mounted.sync.status !== "loading")
    expect(mounted.sync.data.agent_status).toBe("loading")
    await waitFor(() => findText(mounted.app.renderer.root, "Loading") !== undefined)
    await waitFor(() => mounted.keymap.getCommands().some((command) => command.name === "dialog.select.submit"))

    const wrapper = attentionWrapper(mounted.app.renderer.root)
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

test("locked DialogSelect dispatches loading attention without submitting", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "dialog-select-locked")

  try {
    await waitFor(() => mounted.keymap.getCommands().some((command) => command.name === "dialog.select.submit"))
    mounted.keymap.dispatchCommand("dialog.select.submit")
    expect(mounted.emptySubmitCalls()).toBe(1)
  } finally {
    await mounted.cleanup()
  }
})

test("viewing all workspaces keeps the warp dialog lifecycle active", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountLoadingGate(tmp.path, "workspace-select")

  try {
    await waitFor(() => mounted.project.workspace.list().length === 4, 2000, "workspace list did not settle")
    await waitFor(
      () => Object.keys(mounted.project.workspace.statuses()).length === 4,
      2000,
      "workspace statuses did not settle",
    )
    await waitFor(
      () => mounted.keymap.getCommands().some((command) => command.name === "dialog.select.submit"),
      2000,
      "workspace dialog commands did not register",
    )
    await waitFor(() => mounted.workspaceSelect() !== undefined, 2000, "workspace select ref was not set")
    const controller = mounted.workspaceSelect()!
    controller.showAll()
    expect(controller.showingAll()).toBe(true)
    await mounted.app.renderOnce()
    expect(mounted.workspaceDialogClosed()).toBe(0)
  } finally {
    await mounted.cleanup()
  }
})
