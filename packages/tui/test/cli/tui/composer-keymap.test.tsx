/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { afterAll, expect, test } from "bun:test"
import { createSignal, onMount, Show } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import type { TuiKeybind } from "../../../src/config/keybind"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { StorageProvider } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const sessions = {
  parent: session("parent", "Parent"),
  "child-a": session("child-a", "First", "parent"),
  "child-b": session("child-b", "Second", "parent"),
  "child-c": session("child-c", "Third", "parent"),
}

const state = await tmpdir()
afterAll(() => state[Symbol.asyncDispose]())

const shells = [shell("sh-a", "bun test"), shell("sh-b", "bun dev"), shell("sh-c", "python3 - <<'PY'\nimport json")]

async function renderComposer(
  defaultTab: "subagents" | "shell",
  keybinds: Partial<TuiKeybind.Keybinds>,
  options: { focusedTextarea?: boolean; hideSubagents?: () => boolean } = {},
) {
  const focusedTextarea = options.focusedTextarea ?? false
  const events = createEventStream()
  const interrupted: string[] = []
  const removed: string[] = []
  const viewed: string[] = []
  const ready = Promise.withResolvers<void>()
  let closed = 0
  let dispatch!: ReturnType<typeof Keymap.use>["dispatch"]
  let route!: ReturnType<typeof useRoute>
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session/active")
      return json({ data: { "child-a": { type: "running" }, "child-b": { type: "running" } } })
    const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (sessionID && sessionID in sessions) return json({ data: sessions[sessionID as keyof typeof sessions] })
    const interruptID = url.pathname.match(/^\/api\/session\/([^/]+)\/interrupt$/)?.[1]
    if (interruptID && request.method === "POST") {
      interrupted.push(interruptID)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/shell" && request.method === "GET") {
      const requestDirectory = url.searchParams.get("location[directory]") ?? directory
      return json({
        location: { directory: requestDirectory, project: { id: "proj_test", directory: requestDirectory } },
        data: shells,
      })
    }
    const shellID = url.pathname.match(/^\/api\/shell\/([^/]+)$/)?.[1]
    if (shellID && request.method === "GET") {
      viewed.push(shellID)
      return json({ location: { directory }, data: shells.find((shell) => shell.id === shellID) })
    }
    if (url.pathname.endsWith("/output")) {
      return json({ location: { directory }, data: { output: "", cursor: 0, size: 0, truncated: false } })
    }
    if (shellID && request.method === "DELETE") {
      removed.push(shellID)
      return new Response(null, { status: 204 })
    }
  }, events)

  function Content() {
    const data = useData()
    route = useRoute()
    dispatch = Keymap.use().dispatch
    onMount(() => {
      void Promise.all([
        data.session.sync("parent"),
        data.session.sync("child-a"),
        data.session.sync("child-b"),
        data.session.sync("child-c"),
        data.shell.sync(),
      ])
        .then(() => wait(() => data.session.status("child-a") === "running"))
        .then(() => ready.resolve(), ready.reject)
    })
    return (
      <>
        {focusedTextarea && <textarea focused={true} initialValue="draft" />}
        {/* Mirrors the app, which keys the session route by sessionID and remounts it on navigation. */}
        <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
          {(sessionID) => (
            <Composer
              sessionID={sessionID}
              open={true}
              defaultTab={defaultTab}
              onClose={() => closed++}
              hideSubagents={options.hideSubagents?.()}
            />
          )}
        </Show>
      </>
    )
  }

  function AppExit() {
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "app.exit", title: "Exit", group: "System", run: () => {} }],
    }))
    Keymap.createLayer(() => ({ bindings: ["app.exit"] }))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={directory} paths={{ state: state.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig({ keybinds })}>
              <Keymap.Provider>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={process.cwd()}>
                    <LocationProvider>
                      <RouteProvider initialRoute={{ type: "session", sessionID: "parent" }}>
                        <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                          <ToastProvider>
                            <DialogProvider>
                              <Content />
                            </DialogProvider>
                          </ToastProvider>
                        </ThemeProvider>
                      </RouteProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
                <AppExit />
              </Keymap.Provider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 20, kittyKeyboard: true },
  )
  await ready.promise
  await app.renderOnce()
  return {
    app,
    interrupted,
    removed,
    viewed,
    route: () => route.data,
    dispatch: (command: string) => dispatch(command),
    closed: () => closed,
  }
}

test("disabled subagent bindings have no component fallbacks", async () => {
  const composer = await renderComposer("subagents", {
    "composer.subagent.up": "none",
    "composer.subagent.down": "none",
    "composer.subagent.select": "none",
    "composer.subagent.interrupt": "none",
  })
  try {
    expect(composer.app.captureCharFrame()).toContain("First")
    composer.app.mockInput.pressArrow("up")
    composer.app.mockInput.pressEnter()
    composer.app.mockInput.pressKey("d", { ctrl: true })
    await composer.app.renderOnce()
    expect(composer.closed()).toBe(0)
    expect(composer.route()).toMatchObject({ type: "session", sessionID: "parent" })
    expect(composer.interrupted).toEqual([])

    composer.app.mockInput.pressArrow("down")
    composer.dispatch("composer.subagent.select")
    expect(composer.route()).toMatchObject({ type: "session", sessionID: "child-a" })
  } finally {
    composer.app.renderer.destroy()
  }
})

test("the inactive subagent filter only changes with its toggle", async () => {
  const composer = await renderComposer("subagents", {})
  try {
    expect(composer.app.captureCharFrame()).toContain("First")
    expect(composer.app.captureCharFrame()).not.toContain("Third")

    composer.app.mockInput.pressKey("a", { ctrl: true })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("Third")
    expect(composer.app.captureCharFrame()).not.toContain("First")

    composer.app.mockInput.pressEnter()
    expect(composer.route()).toMatchObject({ type: "session", sessionID: "child-c" })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("Third")
    expect(composer.app.captureCharFrame()).toContain("show active")
    expect(composer.app.captureCharFrame()).not.toContain("First")

    composer.app.mockInput.pressKey("a", { ctrl: true })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("First")
    expect(composer.app.captureCharFrame()).not.toContain("Third")
  } finally {
    composer.app.renderer.destroy()
  }
})

test("suppressed Subagents unregisters its card without affecting Shell", async () => {
  const composer = await renderComposer("shell", {}, { hideSubagents: () => true })
  try {
    const frame = composer.app.captureCharFrame()
    expect(frame).not.toContain("Subagents")
    expect(frame).not.toContain("show inactive")
    expect(frame).toContain("Shell")
    expect(frame).toContain("bun test")
    composer.app.mockInput.pressArrow("right")
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).not.toContain("Subagents")
    expect(composer.app.captureCharFrame()).toContain("bun test")
  } finally {
    composer.app.renderer.destroy()
  }
})

test("live Subagents toggles preserve filter, tab order, and route remounts", async () => {
  const [hidden, setHidden] = createSignal(false)
  const composer = await renderComposer("subagents", {}, { hideSubagents: hidden })
  try {
    composer.app.mockInput.pressKey("a", { ctrl: true })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("Third")
    setHidden(true)
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).not.toContain("Subagents")
    expect(composer.app.captureCharFrame()).not.toContain("show active")
    setHidden(false)
    await composer.app.renderOnce()
    const frame = composer.app.captureCharFrame()
    expect(frame).toContain("Third")
    expect(frame.indexOf("Subagents")).toBeLessThan(frame.indexOf("Shell"))
    composer.app.mockInput.pressArrow("right")
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("bun test")
    composer.app.mockInput.pressArrow("left")
    await composer.app.renderOnce()
    composer.app.mockInput.pressEnter()
    expect(composer.route()).toMatchObject({ sessionID: "child-c" })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("Third")
    expect(composer.app.captureCharFrame()).toContain("show active")
  } finally {
    composer.app.renderer.destroy()
  }
})

test("disabled shell bindings have no component fallbacks", async () => {
  const composer = await renderComposer("shell", {
    "composer.shell.up": "none",
    "composer.shell.down": "none",
    "composer.shell.select": "none",
    "composer.shell.kill": "none",
  })
  try {
    expect(composer.app.captureCharFrame()).toContain("bun test")
    composer.app.mockInput.pressArrow("up")
    composer.app.mockInput.pressEnter()
    composer.app.mockInput.pressKey("d", { ctrl: true })
    await composer.app.renderOnce()
    expect(composer.closed()).toBe(0)
    expect(composer.removed).toEqual([])
    expect(composer.viewed).toEqual([])

    composer.app.mockInput.pressArrow("down")
    composer.dispatch("composer.shell.kill")
    await wait(() => composer.removed.length === 1)
    expect(composer.removed).toEqual(["sh-a"])
  } finally {
    composer.app.renderer.destroy()
  }
})

test("shell list shows one line per command", async () => {
  const composer = await renderComposer("shell", {})
  try {
    const frame = composer.app.captureCharFrame()
    expect(frame).toContain("python3 - <<'PY'")
    expect(frame).not.toContain("import json")
  } finally {
    composer.app.renderer.destroy()
  }
})

test("configured composer bindings work with a focused textarea", async () => {
  const composer = await renderComposer("subagents", { "composer.shell.kill": "ctrl+u" }, { focusedTextarea: true })
  try {
    composer.app.mockInput.pressArrow("right")
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("bun test")
    composer.app.mockInput.pressKey("u", { ctrl: true })
    await wait(() => composer.removed.length === 1)
    expect(composer.removed).toEqual(["sh-a"])
  } finally {
    composer.app.renderer.destroy()
  }
})

test("ctrl+c closes the active composer", async () => {
  const composer = await renderComposer("shell", {})

  try {
    composer.app.mockInput.pressKey("c", { ctrl: true })
    await composer.app.waitFor(() => composer.closed() === 1)
  } finally {
    composer.app.renderer.destroy()
  }
})

test("shell output respects a configured binding with a focused textarea", async () => {
  const composer = await renderComposer("shell", { "composer.shell.select": "ctrl+o" }, { focusedTextarea: true })
  try {
    composer.app.mockInput.pressEnter()
    await composer.app.renderOnce()
    expect(composer.viewed).toEqual([])
    composer.app.mockInput.pressKey("o", { ctrl: true })
    await wait(() => composer.viewed.length > 0)
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("Shell output")
    expect(composer.viewed).toEqual(["sh-a"])
  } finally {
    composer.app.renderer.destroy()
  }
})

function session(id: string, title: string, parentID?: string) {
  return {
    id,
    projectID: "proj_test",
    title,
    agent: "build",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    ...(parentID ? { parentID } : {}),
  }
}

function shell(id: string, command: string) {
  return {
    id,
    status: "running" as const,
    command,
    cwd: directory,
    shell: "/bin/sh",
    file: `/tmp/${id}`,
    metadata: { sessionID: "parent" },
    time: { started: 1 },
  }
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}
