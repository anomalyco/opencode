/**
 * @jsxImportSource @opentui/solid
 *
 * TDD RED tests for the /cd directory switch command.
 *
 * These tests verify:
 * 1. Plugin registration — the /cd command is registered via keymap.registerLayer
 * 2. Command properties — slashName, category, name, title
 * 3. run() callback — opens a dialog via api.ui.dialog.replace
 * 4. submit() flow — calls moveSession, promptAsync, vcs.get with correct payloads
 * 5. Error handling — shows a toast on failure
 *
 * The submit-flow tests mock the context hooks (useSDK, useSync, useToast,
 * useDialog, useProject) and render the ChangeDirectoryDialog component
 * through the plugin's run() callback. They simulate typing a path and
 * pressing Enter to trigger submit().
 */
import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { InputRenderable } from "@opentui/core"
import { createTuiPluginApi } from "../../../test/fixture/tui-plugin"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for any mock function. */
type MockFn = ReturnType<typeof mock>

/**
 * Capture the registered command from a mock API.
 * Returns the api, the registerLayer spy, and the replace spy.
 */
function setupPluginRegistration() {
  const registerLayer = mock((_layer: unknown) => {})
  const replace = mock((_fn: () => unknown) => {})
  const api = createTuiPluginApi({
    keymap: { registerLayer, dispatchCommand: () => false } as never,
  })
  api.ui.dialog.replace = replace as never
  return { api, registerLayer, replace }
}

/** Load the plugin and return its default export. */
async function loadPlugin() {
  const mod = await import("./change-directory")
  return mod.default
}

/** Traverse a renderable tree and return the first InputRenderable. */
function findInput(root: unknown): InputRenderable | undefined {
  if (root instanceof InputRenderable) return root
  const node = root as { getChildren?: () => unknown[] }
  const children = node.getChildren?.() ?? []
  for (const child of children) {
    const found = findInput(child)
    if (found) return found
  }
  return undefined
}

/**
 * Set up mocks for the five context hooks used by ChangeDirectoryDialog.
 * Returns mock objects and spy functions for assertion.
 */
function mockContexts(options: {
  sessionID?: string
  vcsData?: unknown
} = {}) {
  const sessionID = options.sessionID ?? "session-123"
  const vcsData = options.vcsData ?? { branch: "main" }

  const moveSession = mock(() => Promise.resolve({ data: undefined }))
  const promptAsync = mock(() => Promise.resolve({ data: undefined }))
  const vcsGet = mock(() => Promise.resolve({ data: vcsData }))
  const setStore = mock(() => {})
  const toastShow = mock(() => {})
  const dialogClear = mock(() => {})

  const sdk = {
    client: {
      experimental: { controlPlane: { moveSession } },
      session: { promptAsync },
      vcs: { get: vcsGet },
    },
  }

  const sync = {
    session: {
      current: () => (sessionID ? { id: sessionID } : undefined),
    },
    // The SyncContext exposes `set` (not `setStore`). Including both so the
    // test reveals which one the code actually calls.
    set: setStore,
    setStore,
  }

  const toast = {
    show: toastShow,
    error: mock(() => {}),
    currentToast: null,
  }

  const dialog = {
    clear: dialogClear,
    replace: mock(() => {}),
    setSize: mock(() => {}),
    size: "medium" as const,
    depth: 0,
    open: false,
  }

  const project = {
    instance: {
      directory: () => "/old/path",
      path: () => ({
        home: "",
        state: "",
        config: "",
        worktree: "",
        directory: "/old/path",
      }),
    },
    workspace: {
      current: () => undefined,
    },
  }

  return {
    sdk,
    sync,
    toast,
    dialog,
    project,
    spies: { moveSession, promptAsync, vcsGet, setStore, toastShow, dialogClear },
  }
}

/**
 * Full setup: mock contexts, import the plugin, register the command,
 * capture the dialog factory from run(), render the component, and focus
 * the input element so typing and Enter work.
 */
async function renderChangeDirectoryDialog(options?: {
  sessionID?: string
  vcsData?: unknown
}) {
  const ctx = mockContexts(options)

  // Mock context modules BEFORE importing the plugin
  mock.module("../../context/sdk", () => ({ useSDK: () => ctx.sdk }))
  mock.module("../../context/sync", () => ({ useSync: () => ctx.sync }))
  mock.module("../../ui/toast", () => ({ useToast: () => ctx.toast }))
  mock.module("../../ui/dialog", () => ({ useDialog: () => ctx.dialog }))
  mock.module("../../context/project", () => ({ useProject: () => ctx.project }))

  try {
    const plugin = await loadPlugin()
    const { api, registerLayer, replace } = setupPluginRegistration()
    await plugin.tui(api, undefined, {} as never)

    const command = registerLayer.mock.calls[0][0].commands[0]

    // Capture the factory passed to dialog.replace
    let factory: (() => unknown) | undefined
    replace.mockImplementation((fn: () => unknown) => {
      factory = fn
    })
    command.run()
    if (!factory) throw new Error("dialog.replace was not called by run()")

    const app = await testRender(() => factory() as never)

    // Wait for the component to mount, then find and focus the input
    await Bun.sleep(100)
    const input = findInput((app.renderer as unknown as { root: unknown }).root)
    if (!input) throw new Error("InputRenderable not found in rendered tree")
    input.focus()
    await Bun.sleep(10)

    return { app, ctx, spies: ctx.spies, input }
  } catch (err) {
    mock.restore()
    throw err
  }
}

/** Wait for a condition, polling every 10ms, up to a timeout. */
async function wait(predicate: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Registration Tests (no rendering required)
// ---------------------------------------------------------------------------

test("plugin id is 'change-directory'", async () => {
  const plugin = await loadPlugin()
  expect(plugin.id).toBe("change-directory")
})

test("tui() registers a command layer via api.keymap.registerLayer", async () => {
  const plugin = await loadPlugin()
  const { api, registerLayer } = setupPluginRegistration()
  await plugin.tui(api, undefined, {} as never)
  expect(registerLayer).toHaveBeenCalledTimes(1)
  const layer = registerLayer.mock.calls[0][0] as { commands: unknown[] }
  expect(layer.commands).toHaveLength(1)
})

test("registered command has slashName 'cd' and category 'Session'", async () => {
  const plugin = await loadPlugin()
  const { api, registerLayer } = setupPluginRegistration()
  await plugin.tui(api, undefined, {} as never)
  const command = registerLayer.mock.calls[0][0] as {
    commands: { name: string; title: string; slashName: string; category: string }[]
  }
  const cmd = command.commands[0]
  expect(cmd.name).toBe("cd.open")
  expect(cmd.title).toBe("Change directory")
  expect(cmd.slashName).toBe("cd")
  expect(cmd.category).toBe("Session")
})

test("run() opens a dialog via api.ui.dialog.replace", async () => {
  const plugin = await loadPlugin()
  const { api, registerLayer, replace } = setupPluginRegistration()
  await plugin.tui(api, undefined, {} as never)
  const layer = registerLayer.mock.calls[0][0] as {
    commands: { run(): void }[]
  }
  layer.commands[0].run()
  expect(replace).toHaveBeenCalledTimes(1)
  expect(typeof replace.mock.calls[0][0]).toBe("function")
})

// ---------------------------------------------------------------------------
// Part 2 — Submit Flow Tests (rendered component with mocked contexts)
// ---------------------------------------------------------------------------

test("submit() calls moveSession with sessionID, destination, and moveChanges=false", async () => {
  const { app, spies } = await renderChangeDirectoryDialog()

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.moveSession.mock.calls.length > 0)

    const call = spies.moveSession.mock.calls[0]
    const body = call[0] as { sessionID: string; destination: { directory: string }; moveChanges: boolean }
    const opts = call[1] as { throwOnError: boolean }
    expect(body.sessionID).toBe("session-123")
    expect(body.destination).toEqual({ directory: "/new/worktree" })
    expect(body.moveChanges).toBe(false)
    expect(opts).toEqual({ throwOnError: true })
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})

test("submit() calls promptAsync with a system-reminder containing the new directory", async () => {
  const { app, spies } = await renderChangeDirectoryDialog()

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.promptAsync.mock.calls.length > 0)

    const call = spies.promptAsync.mock.calls[0]
    const body = call[0] as {
      sessionID: string
      directory: string
      noReply: boolean
      parts: { type: string; text: string; synthetic: boolean }[]
    }
    expect(body.sessionID).toBe("session-123")
    expect(body.directory).toBe("/new/worktree")
    expect(body.noReply).toBe(true)
    expect(body.parts).toHaveLength(1)
    const part = body.parts[0]
    expect(part.type).toBe("text")
    expect(part.synthetic).toBe(true)
    expect(part.text).toContain("/new/worktree")
    expect(part.text).toContain("system-reminder")
    expect(part.text).toContain("changed the working directory")
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})

test("submit() refreshes VCS via vcs.get after a successful move", async () => {
  const { app, spies } = await renderChangeDirectoryDialog({ vcsData: { branch: "develop" } })

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.vcsGet.mock.calls.length > 0)

    expect(spies.vcsGet).toHaveBeenCalledTimes(1)
    // VCS data should be stored via the sync store
    await wait(() => spies.setStore.mock.calls.some((c) => c[0] === "vcs"))
    const setStoreCall = spies.setStore.mock.calls.find((c) => c[0] === "vcs")
    expect(setStoreCall![1]).toEqual({ branch: "develop" })
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})

test("submit() shows a success toast after a successful move", async () => {
  const { app, spies } = await renderChangeDirectoryDialog()

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.toastShow.mock.calls.length > 0)

    const toastCall = spies.toastShow.mock.calls[0][0] as {
      variant: string
      title: string
      message: string
    }
    expect(toastCall.variant).toBe("info")
    expect(toastCall.title).toBe("Changed directory")
    expect(toastCall.message).toBe("/new/worktree")
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})

test("submit() shows an error toast when moveSession fails", async () => {
  const { app, spies } = await renderChangeDirectoryDialog()

  // Override moveSession to reject
  spies.moveSession.mockImplementation(() => Promise.reject(new Error("Network failure")))

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.toastShow.mock.calls.length > 0)

    const toastCall = spies.toastShow.mock.calls[0][0] as {
      variant: string
      title: string
      message: string
    }
    expect(toastCall.variant).toBe("error")
    expect(toastCall.title).toBe("Failed to change directory")
    expect(toastCall.message).toContain("Network failure")
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})

test("submit() shows an error toast when no active session exists", async () => {
  const { app, spies } = await renderChangeDirectoryDialog({ sessionID: "" })

  try {
    await app.mockInput.typeText("/new/worktree")
    app.mockInput.pressEnter()

    await wait(() => spies.toastShow.mock.calls.length > 0)

    const toastCall = spies.toastShow.mock.calls[0][0] as {
      variant: string
      title: string
    }
    expect(toastCall.variant).toBe("error")
    expect(toastCall.title).toBe("No active session")
    expect(spies.moveSession).not.toHaveBeenCalled()
  } finally {
    app.renderer.destroy()
    mock.restore()
  }
})
