/** @jsxImportSource @opentui/solid */
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, Show } from "solid-js"
import { Prompt, PromptInterruptStatus, type PromptRef } from "../../../src/component/prompt"
import {
  PendingCommands,
  PromptPendingCommands,
  formatPendingCommandText,
  type PendingCommand,
} from "../../../src/component/prompt/pending-command"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { EditorContextProvider } from "../../../src/context/editor"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { PromptRefProvider } from "../../../src/context/prompt"
import { RouteProvider } from "../../../src/context/route"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { TuiAppProvider, TuiLifecycleProvider } from "../../../src/context/runtime"
import { AttentionProvider } from "../../../src/context/attention"
import { ExitProvider } from "../../../src/context/exit"
import { PluginProvider } from "../../../src/plugin/context"
import { DialogProvider } from "../../../src/ui/dialog"
import { SESSION_SIDEBAR_WIDTH, sessionTabsFitVertically } from "../../../src/ui/layout"
import { ToastProvider } from "../../../src/ui/toast"
import { PromptHistoryProvider } from "../../../src/prompt/history"
import { PromptStashProvider } from "../../../src/prompt/stash"
import { FrecencyProvider } from "../../../src/prompt/frecency"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json, type FetchHandler } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { agent, model, session } from "../../fixture/local"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("formatPendingCommandText formats single, queued, and multiple commands", () => {
  const single: PendingCommand = {
    id: "1",
    sessionID: Session.ID.make("s1", { disableChecks: true }),
    name: "mcp-cmd",
    arguments: "arg1",
    delivery: "steer",
  }
  expect(formatPendingCommandText(single)).toBe("Resolving /mcp-cmd arg1…")

  const queued: PendingCommand = {
    id: "2",
    sessionID: Session.ID.make("s1", { disableChecks: true }),
    name: "mcp-cmd",
    arguments: "arg1",
    delivery: "queue",
  }
  expect(formatPendingCommandText(queued)).toBe("Resolving /mcp-cmd arg1 (queue)…")

  expect(formatPendingCommandText(single, 2)).toBe("Resolving /mcp-cmd arg1 (+2 more)…")
})

test("PromptPendingCommands renders in narrow and wide terminal layouts", async () => {
  const command: PendingCommand = {
    id: "cmd_1",
    sessionID: Session.ID.make("s1", { disableChecks: true }),
    name: "slow-prompt",
    arguments: "hello world",
    delivery: "steer",
  }

  for (const width of [40, 120]) {
    function LayoutHarness() {
      const theme = useTheme()
      return (
        <box width={width} height={2} flexDirection="row" gap={1}>
          <PromptPendingCommands commands={[command]} />
          <PromptInterruptStatus
            armed={false}
            text={theme.text.base}
            subdued={theme.text.muted}
            warning={theme.text.feedback.warning.base}
          />
        </box>
      )
    }

    const app = await testRender(
      () => (
        <TestTuiContexts cwd="/tmp/opencode">
          <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <LayoutHarness />
            </ThemeProvider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width, height: 2 },
    )
    app.renderer.start()

    try {
      await wait(() => {
        const frame = app.captureCharFrame()
        return frame.includes("Resolving /slow-prompt") && frame.includes("hello world…")
      })
      const frame = app.captureCharFrame()
      expect(frame).toContain("Resolving /slow-prompt")
      expect(frame).toContain("hello world…")
    } finally {
      app.renderer.destroy()
    }
  }
})

async function mountProductionPrompt(input: {
  sessionID: Session.ID
  fetch?: FetchHandler
  width?: number
  height?: number
  promptWidth?: number
  animations?: boolean
}) {
  const temporary = await tmpdir()
  await mkdir(path.join(temporary.path, "test", "locks"), { recursive: true })
  await Bun.write(path.join(temporary.path, "model.json"), JSON.stringify({}))
  await Bun.write(path.join(temporary.path, "session.json"), JSON.stringify({}))
  const events = createEventStream()

  const commands = [
    { name: "mcp-slow", description: "Slow MCP prompt" },
    { name: "mcp-fail", description: "Failing MCP prompt" },
    { name: "first-cmd", description: "First concurrent command" },
    { name: "second-cmd", description: "Second concurrent command" },
  ]

  const calls = createFetch(async (url, request) => {
    const response = await input.fetch?.(url, request)
    if (response) return response

    const location = { directory: url.searchParams.get("location[directory]") ?? directory }
    if (url.pathname === "/api/agent") return json({ location, data: [agent("build")] })
    if (url.pathname === "/api/model") return json({ location, data: [model("first")] })
    if (url.pathname === "/api/command") return json({ location, data: commands })
    if (/^\/api\/session\/[^/]+$/.test(url.pathname))
      return json({
        data: session(Session.ID.make(url.pathname.split("/").at(-1)!, { disableChecks: true }), {
          providerID: Provider.ID.make("provider"),
          id: Model.ID.make("first"),
        }),
      })
  }, events)

  const [activeSession, setActiveSession] = createSignal(input.sessionID)
  const [promptWidth, setPromptWidth] = createSignal(input.promptWidth)
  let local!: ReturnType<typeof useLocal>
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>
  let promptRef!: PromptRef | undefined

  function Probe() {
    local = useLocal()
    data = useData()
    storage = useStorage()
    return null
  }

  function Harness() {
    return (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <TuiLifecycleProvider value={{ add: () => () => {} }}>
            <ExitProvider exit={() => {}}>
              <StorageProvider>
                <ArgsProvider>
                  <ConfigProvider config={createTuiResolvedConfig({ animations: input.animations ?? false })}>
                    <Keymap.Provider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <ToastProvider>
                          <RouteProvider initialRoute={{ type: "session", sessionID: input.sessionID }}>
                            <ClientProvider api={createApi(calls.fetch)}>
                              <DataProvider directory={directory}>
                                <LocationProvider>
                                  <PermissionProvider>
                                    <LocalProvider>
                                      <Probe />
                                      <SessionTabsProvider>
                                        <FrecencyProvider>
                                          <PromptHistoryProvider>
                                            <PromptStashProvider>
                                              <PromptRefProvider>
                                                <EditorContextProvider>
                                                  <DialogProvider>
                                                    <AttentionProvider>
                                                      <PluginProvider
                                                        packages={{
                                                          prepare: async () => {
                                                            throw new Error("Unexpected plugin package request")
                                                          },
                                                        }}
                                                        directories={[]}
                                                      >
                                                        <box width={promptWidth() ?? "100%"} height="100%">
                                                          <box flexGrow={1}>
                                                            <text>SESSION HISTORY SENTINEL</text>
                                                          </box>
                                                          <box flexShrink={0}>
                                                            <Show when={activeSession()} keyed>
                                                              {(sessionID) => (
                                                                <Prompt
                                                                  sessionID={sessionID}
                                                                  ref={(ref) => {
                                                                    promptRef = ref
                                                                  }}
                                                                />
                                                              )}
                                                            </Show>
                                                          </box>
                                                        </box>
                                                      </PluginProvider>
                                                    </AttentionProvider>
                                                  </DialogProvider>
                                                </EditorContextProvider>
                                              </PromptRefProvider>
                                            </PromptStashProvider>
                                          </PromptHistoryProvider>
                                        </FrecencyProvider>
                                      </SessionTabsProvider>
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
              </StorageProvider>
            </ExitProvider>
          </TuiLifecycleProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, {
    width: input.width ?? 100,
    height: input.height ?? 10,
    kittyKeyboard: true,
  })
  app.renderer.start()

  await wait(() => local !== undefined)
  await wait(() => local.model.ready)
  await wait(() => promptRef !== undefined)
  await data.location.sync()
  await data.session.sync(input.sessionID)

  return {
    app,
    events,
    setActiveSession,
    setPromptWidth,
    get promptRef() {
      return promptRef!
    },
    data,
    temporary,
    async cleanup() {
      app.renderer.destroy()
      await storage?.flush().catch(() => {})
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test("production Prompt shows pending state immediately on slash command submit and removes on resolve", async () => {
  PendingCommands.clear()
  const commandSettled = Promise.withResolvers<Response>()
  let commandCalled = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_prompt_success", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname === "/api/session/ses_prompt_success/command" && request.method === "POST") {
        commandCalled = true
        return commandSettled.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")

    // Type slash command
    textarea.setText("/mcp-slow hello world")
    await harness.app.renderOnce()

    // Submit
    harness.app.mockInput.pressEnter()
    await wait(() => commandCalled)

    // Verify input cleared immediately
    expect(textarea.plainText).toBe("")

    // Verify pending command is in store and visible in TUI frame
    expect(PendingCommands.list(Session.ID.make("ses_prompt_success", { disableChecks: true }))).toHaveLength(1)
    expect(PendingCommands.list(Session.ID.make("ses_prompt_success", { disableChecks: true }))[0].name).toBe(
      "mcp-slow",
    )
    expect(PendingCommands.list(Session.ID.make("ses_prompt_success", { disableChecks: true }))[0].arguments).toBe(
      "hello world",
    )

    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).toContain("Resolving /mcp-slow hello world…")

    // Resolve command
    commandSettled.resolve(new Response(null, { status: 204 }))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prompt_success", { disableChecks: true })).length === 0)

    // Verify pending indicator cleared
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving")
  } finally {
    await harness.cleanup()
  }
})

test("production Prompt shows pending state on failing command and restores draft if no newer input was typed", async () => {
  PendingCommands.clear()
  const commandSettled = Promise.withResolvers<Response>()
  let commandCalled = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_prompt_fail", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname === "/api/session/ses_prompt_fail/command" && request.method === "POST") {
        commandCalled = true
        return commandSettled.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")

    // Type slash command
    textarea.setText("/mcp-fail test-args")
    await harness.app.renderOnce()

    // Submit
    harness.app.mockInput.pressEnter()
    await wait(() => commandCalled)

    // Verify pending state active
    expect(PendingCommands.list(Session.ID.make("ses_prompt_fail", { disableChecks: true }))).toHaveLength(1)
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).toContain("Resolving /mcp-fail test-args…")

    // Fail the command
    commandSettled.reject(new Error("MCP server timeout"))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prompt_fail", { disableChecks: true })).length === 0)

    // Verify pending indicator cleared and composer restored draft
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving")
    expect(textarea.plainText).toBe("/mcp-fail test-args")
  } finally {
    await harness.cleanup()
  }
})

test("production Prompt preserves newly typed input when an in-flight command fails", async () => {
  PendingCommands.clear()
  const commandSettled = Promise.withResolvers<Response>()
  let commandCalled = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_prompt_typing", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname === "/api/session/ses_prompt_typing/command" && request.method === "POST") {
        commandCalled = true
        return commandSettled.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")

    // Submit slow command
    textarea.setText("/mcp-slow old draft")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => commandCalled)

    // Composer was cleared; user types new text while command is in flight
    expect(textarea.plainText).toBe("")
    textarea.setText("brand new user message")
    await harness.app.renderOnce()

    // Command fails
    commandSettled.reject(new Error("MCP server error"))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prompt_typing", { disableChecks: true })).length === 0)

    // Newly typed text is PRESERVED, not clobbered by old draft
    await harness.app.renderOnce()
    expect(textarea.plainText).toBe("brand new user message")
  } finally {
    await harness.cleanup()
  }
})

test("production Prompt handles multiple concurrent slash command submissions", async () => {
  PendingCommands.clear()
  const firstSettled = Promise.withResolvers<Response>()
  const secondSettled = Promise.withResolvers<Response>()
  const called: string[] = []

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_prompt_multi", { disableChecks: true }),
    fetch: async (url, request) => {
      if (url.pathname === "/api/session/ses_prompt_multi/command" && request.method === "POST") {
        const body = (await request.json()) as { name: string }
        called.push(body.name)
        if (body.name === "first-cmd") return firstSettled.promise
        if (body.name === "second-cmd") return secondSettled.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")

    // Submit first command
    textarea.setText("/first-cmd foo")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called.includes("first-cmd"))

    // Submit second command while first is in flight
    textarea.setText("/second-cmd bar")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called.includes("second-cmd"))

    // Both are pending concurrently
    expect(PendingCommands.list(Session.ID.make("ses_prompt_multi", { disableChecks: true }))).toHaveLength(2)
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).toContain("Resolving /first-cmd foo (+1 more)…")

    // Resolve first command
    firstSettled.resolve(new Response(null, { status: 204 }))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prompt_multi", { disableChecks: true })).length === 1)

    // Second command is now the primary visible pending command
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).toContain("Resolving /second-cmd bar…")

    // Resolve second command
    secondSettled.resolve(new Response(null, { status: 204 }))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prompt_multi", { disableChecks: true })).length === 0)

    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving")
  } finally {
    await harness.cleanup()
  }
})

test("production Prompt preserves failed command draft after blank Enter", async () => {
  PendingCommands.clear()
  const deferred = Promise.withResolvers<Response>()
  let called = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_review_blank", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname.endsWith("/command") && request.method === "POST") {
        called = true
        return deferred.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("no textarea")

    textarea.setText("/mcp-slow important arguments")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called)
    expect(textarea.plainText).toBe("")

    // Press Enter in empty composer without typing anything
    harness.app.mockInput.pressEnter()
    await Bun.sleep(100)

    // Reject the pending command
    deferred.reject(new Error("MCP resolution failed"))
    await wait(() => PendingCommands.list(Session.ID.make("ses_review_blank", { disableChecks: true })).length === 0)
    await harness.app.renderOnce()

    // Original command draft is restored successfully
    expect(textarea.plainText).toBe("/mcp-slow important arguments")
  } finally {
    await harness.cleanup()
  }
})

test("production Prompt pending indicator follows keyed session remounts", async () => {
  PendingCommands.clear()
  const deferred = Promise.withResolvers<Response>()
  let called = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_review_switch", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname.endsWith("/command") && request.method === "POST") {
        called = true
        return deferred.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("no textarea")

    textarea.setText("/mcp-slow first session")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called)

    // Switch to another session
    harness.setActiveSession(Session.ID.make("ses_review_other", { disableChecks: true }))
    await harness.data.session.sync(Session.ID.make("ses_review_other", { disableChecks: true }))
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving /mcp-slow")

    // Switch back to original session
    harness.setActiveSession(Session.ID.make("ses_review_switch", { disableChecks: true }))
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).toContain("Resolving /mcp-slow first session")

    // Resolve command
    deferred.resolve(new Response(null, { status: 204 }))
    await wait(() => PendingCommands.list(Session.ID.make("ses_review_switch", { disableChecks: true })).length === 0)
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving /mcp-slow")
  } finally {
    await harness.cleanup()
  }
})

// A 120-column terminal supports the default rail; Session adds two columns padding per side.
const verticalPromptWidth = 120 - SESSION_SIDEBAR_WIDTH - 4
for (const layout of [{ width: 40 }, { width: 120 }, { width: 120, promptWidth: verticalPromptWidth }]) {
  for (const animations of [false, true]) {
    test(`production Prompt with long arguments bounds footer and preserves interrupt at ${layout.width}x12 composer=${layout.promptWidth ?? layout.width} animations=${animations}`, async () => {
      PendingCommands.clear()
      const deferred = Promise.withResolvers<Response>()
      const sessionID = Session.ID.make(
        `ses_matrix_${layout.width}_${layout.promptWidth ?? layout.width}_${animations}`,
        { disableChecks: true },
      )
      let called = false

      const harness = await mountProductionPrompt({
        sessionID,
        width: layout.width,
        promptWidth: layout.promptWidth,
        height: 12,
        animations,
        fetch: (url, request) => {
          if (url.pathname.endsWith("/command") && request.method === "POST") {
            called = true
            return deferred.promise
          }
        },
      })

      try {
        await harness.app.renderOnce()
        const textarea = harness.app.renderer.currentFocusedEditor
        if (!(textarea instanceof TextareaRenderable)) throw new Error("no textarea")

        // Mark session as running
        harness.events.emit({
          id: Event.ID.make(`evt_${sessionID}`, { disableChecks: true }),
          created: 0,
          type: "session.execution.started",
          durable: { aggregateID: sessionID, seq: 1, version: 1 },
          data: { sessionID },
        })
        await wait(() => harness.data.session.status(sessionID) === "running")

        // Submit long arguments (60 x 14 chars = 840 chars)
        textarea.setText("/mcp-slow " + "long argument ".repeat(60))
        await harness.app.renderOnce()
        harness.app.mockInput.pressEnter()
        await wait(() => called)

        // User types new draft while pending
        textarea.setText("NEW USER DRAFT")
        await harness.app.renderOnce()
        await Bun.sleep(100)
        await harness.app.renderOnce()

        const pendingFrame = harness.app.captureCharFrame()

        // The armed label is longer, so verify the measured status region updates.
        harness.app.mockInput.pressEscape()
        await wait(() => harness.app.captureCharFrame().includes("esc again to interrupt"))
        await harness.app.renderOnce()
        const armedFrame = harness.app.captureCharFrame()
        expect(armedFrame).toContain("esc again to interrupt")
        expect(armedFrame).toContain("NEW USER DRAFT")
        expect(armedFrame).toContain("SESSION HISTORY SENTINEL")
        expect(armedFrame.split("\n").filter((line) => line.includes("Resol"))).toHaveLength(1)

        // Resolve command with HTTP 204 NoContent
        deferred.resolve(new Response(null, { status: 204 }))
        await wait(() => PendingCommands.list(sessionID).length === 0)
        await harness.app.renderOnce()

        const settledFrame = harness.app.captureCharFrame()

        // Assertions
        expect(textarea.plainText).toBe("NEW USER DRAFT")
        expect(pendingFrame).toContain("SESSION HISTORY SENTINEL")
        expect(pendingFrame).toContain("NEW USER DRAFT")
        expect(pendingFrame).toContain("esc interrupt")
        if (!animations) expect(pendingFrame).toContain("⋯ Resolving")
        if (animations) expect(pendingFrame).not.toContain("⋯ Resolving")
        expect(pendingFrame.split("\n").filter((line) => line.includes("Resolv"))).toHaveLength(1)
        if (layout.width >= 80) {
          expect(pendingFrame).toContain("agents")
          expect(pendingFrame).toContain("commands")
          expect(pendingFrame).toMatch(/agents\s+\S*\s*commands/)
        }
        expect(settledFrame).not.toContain("Resolving")
        expect(settledFrame).toContain("SESSION HISTORY SENTINEL")
        expect(settledFrame).toContain("NEW USER DRAFT")
        expect(settledFrame).toContain("esc again to interrupt")
      } finally {
        deferred.resolve(new Response(null, { status: 204 }))
        await harness.cleanup()
      }
    })
  }
}

test("production Prompt newer meaningful submission suppresses older failed draft", async () => {
  PendingCommands.clear()
  const first = Promise.withResolvers<Response>()
  const second = Promise.withResolvers<Response>()
  const called: string[] = []

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_epoch_meaningful", { disableChecks: true }),
    fetch: async (url, request) => {
      if (url.pathname.endsWith("/command") && request.method === "POST") {
        const payload = (await request.json()) as { name: string }
        called.push(payload.name)
        return payload.name === "first-cmd" ? first.promise : second.promise
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("no textarea")

    textarea.setText("/first-cmd old draft")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called.includes("first-cmd"))

    textarea.setText("/second-cmd new submission")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called.includes("second-cmd"))

    expect(PendingCommands.list(Session.ID.make("ses_epoch_meaningful", { disableChecks: true }))).toHaveLength(2)

    // Resolve second command
    second.resolve(new Response(null, { status: 204 }))
    await wait(
      () => PendingCommands.list(Session.ID.make("ses_epoch_meaningful", { disableChecks: true })).length === 1,
    )
    expect(PendingCommands.list(Session.ID.make("ses_epoch_meaningful", { disableChecks: true }))[0].name).toBe(
      "first-cmd",
    )

    // Fail first command
    first.reject(new Error("older command failed"))
    await wait(
      () => PendingCommands.list(Session.ID.make("ses_epoch_meaningful", { disableChecks: true })).length === 0,
    )
    expect(textarea.plainText).toBe("")
  } finally {
    first.resolve(new Response(null, { status: 204 }))
    second.resolve(new Response(null, { status: 204 }))
    await harness.cleanup()
  }
})

test("production Prompt session switching preserves each new draft and pending feedback", async () => {
  PendingCommands.clear()
  const deferred = Promise.withResolvers<Response>()
  let called = false

  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_draft_a", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname.endsWith("/command") && request.method === "POST") {
        called = true
        return deferred.promise
      }
    },
  })

  const focused = () => {
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("no textarea")
    return textarea
  }

  try {
    await harness.app.renderOnce()
    focused().setText("/mcp-slow session A")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => called)

    focused().setText("draft A")
    await harness.app.renderOnce()

    // Switch to session B
    harness.setActiveSession(Session.ID.make("ses_draft_b", { disableChecks: true }))
    await harness.data.session.sync(Session.ID.make("ses_draft_b", { disableChecks: true }))
    await harness.app.renderOnce()
    expect(harness.app.captureCharFrame()).not.toContain("Resolving")

    focused().setText("draft B")
    await harness.app.renderOnce()

    // Switch back to session A
    harness.setActiveSession(Session.ID.make("ses_draft_a", { disableChecks: true }))
    await harness.app.renderOnce()
    expect(focused().plainText).toBe("draft A")
    expect(harness.app.captureCharFrame()).toContain("Resolving /mcp-slow")

    // Reject command on session A
    deferred.reject(new Error("MCP failure after switching"))
    await wait(() => PendingCommands.list(Session.ID.make("ses_draft_a", { disableChecks: true })).length === 0)
    expect(focused().plainText).toBe("draft A")

    // Switch to session B
    harness.setActiveSession(Session.ID.make("ses_draft_b", { disableChecks: true }))
    await harness.app.renderOnce()
    expect(focused().plainText).toBe("draft B")
  } finally {
    deferred.resolve(new Response(null, { status: 204 }))
    await harness.cleanup()
  }
})

for (const animations of [false, true]) {
  test(`production Prompt recomputes pending width when its container and terminal resize animations=${animations}`, async () => {
    PendingCommands.clear()
    const deferred = Promise.withResolvers<Response>()
    const sessionID = Session.ID.make(`ses_resize_${animations}`, { disableChecks: true })
    let called = false
    const harness = await mountProductionPrompt({
      sessionID,
      width: 120,
      height: 12,
      animations,
      fetch: (url, request) => {
        if (url.pathname.endsWith("/command") && request.method === "POST") {
          called = true
          return deferred.promise
        }
      },
    })

    try {
      expect(sessionTabsFitVertically(120, SESSION_SIDEBAR_WIDTH)).toBe(true)
      await harness.app.renderOnce()
      const textarea = harness.app.renderer.currentFocusedEditor
      if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")
      harness.events.emit({
        id: Event.ID.make(`evt_${sessionID}`, { disableChecks: true }),
        created: 0,
        type: "session.execution.started",
        durable: { aggregateID: sessionID, seq: 1, version: 1 },
        data: { sessionID },
      })
      await wait(() => harness.data.session.status(sessionID) === "running")
      textarea.setText("/mcp-slow " + "long argument ".repeat(60))
      await harness.app.renderOnce()
      harness.app.mockInput.pressEnter()
      await wait(() => called)
      textarea.setText("NEW USER DRAFT")

      for (const layout of [
        { width: 120, promptWidth: verticalPromptWidth },
        { width: 40, promptWidth: undefined },
        { width: 120, promptWidth: verticalPromptWidth },
        { width: 120, promptWidth: undefined },
      ]) {
        harness.setPromptWidth(layout.promptWidth)
        harness.app.resize(layout.width, 12)
        await harness.app.renderOnce()
        await Bun.sleep(30)
        await harness.app.renderOnce()
        const frame = harness.app.captureCharFrame()
        expect(PendingCommands.list(sessionID)).toHaveLength(1)
        expect(textarea.plainText).toBe("NEW USER DRAFT")
        expect(frame).toContain("NEW USER DRAFT")
        expect(frame).toContain("SESSION HISTORY SENTINEL")
        expect(frame).toContain("esc interrupt")
        expect(frame.split("\n").filter((line) => line.includes("Resol"))).toHaveLength(1)
        if (layout.width >= 80) expect(frame).toMatch(/agents\s+\S*\s*commands/)
      }

      deferred.resolve(new Response(null, { status: 204 }))
      await wait(() => PendingCommands.list(sessionID).length === 0)
      await harness.app.renderOnce()
      expect(harness.app.captureCharFrame()).not.toContain("Resolving")
      expect(textarea.plainText).toBe("NEW USER DRAFT")
    } finally {
      deferred.resolve(new Response(null, { status: 204 }))
      await harness.cleanup()
    }
  })
}

test("production Prompt shows pending feedback during selection preparation and restores on preparation failure", async () => {
  PendingCommands.clear()
  const prepared = Promise.withResolvers<Response>()
  let preparing = false
  let commandCalled = false
  const harness = await mountProductionPrompt({
    sessionID: Session.ID.make("ses_prepare_failure", { disableChecks: true }),
    fetch: (url, request) => {
      if (url.pathname === "/api/session/ses_prepare_failure/model" && request.method === "POST") {
        preparing = true
        return prepared.promise
      }
      if (url.pathname === "/api/session/ses_prepare_failure/command" && request.method === "POST") {
        commandCalled = true
        return new Response(null, { status: 204 })
      }
    },
  })

  try {
    await harness.app.renderOnce()
    const textarea = harness.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused prompt textarea")
    textarea.setText("/mcp-slow retained arguments")
    await harness.app.renderOnce()
    harness.app.mockInput.pressEnter()
    await wait(() => preparing)
    await harness.app.renderOnce()
    expect(textarea.plainText).toBe("")
    expect(PendingCommands.list(Session.ID.make("ses_prepare_failure", { disableChecks: true }))).toHaveLength(1)
    expect(harness.app.captureCharFrame()).toContain("Resolving /mcp-slow retained arguments")
    expect(commandCalled).toBeFalse()

    prepared.reject(new Error("Model preparation failed"))
    await wait(() => PendingCommands.list(Session.ID.make("ses_prepare_failure", { disableChecks: true })).length === 0)
    await harness.app.renderOnce()
    expect(commandCalled).toBeFalse()
    expect(textarea.plainText).toBe("/mcp-slow retained arguments")
    expect(harness.app.captureCharFrame()).not.toContain("Resolving")
  } finally {
    prepared.resolve(new Response(null, { status: 204 }))
    await harness.cleanup()
  }
})
