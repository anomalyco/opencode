/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import type { MonitorInfo } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import type { TuiKeybind } from "../../../src/config/keybind"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { DialogProvider } from "../../../src/ui/dialog"
import { Toast, ToastProvider } from "../../../src/ui/toast"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const sessions = {
  parent: session("parent", "Parent"),
  "child-a": session("child-a", "First", "parent"),
  "child-b": session("child-b", "Second", "parent"),
}

const shells = [shell("sh-a", "bun test"), shell("sh-b", "bun dev"), shell("sh-c", "python3 - <<'PY'\nimport json")]

async function renderComposer(
  defaultTab: "subagents" | "shell",
  keybinds: Partial<TuiKeybind.Keybinds>,
  focusedTextarea = false,
  monitors: MonitorInfo[] = [],
  onRemove?: (id: string) => Promise<Response>,
) {
  const events = createEventStream()
  const interrupted: string[] = []
  const removed: string[] = []
  const viewed: string[] = []
  const ready = Promise.withResolvers<void>()
  const monitorEnded = Promise.withResolvers<void>()
  const monitorReloaded = Promise.withResolvers<void>()
  let monitorReads = 0
  let closed = 0
  let dispatch!: ReturnType<typeof Keymap.use>["dispatch"]
  let route!: ReturnType<typeof useRoute>
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session/parent/monitor") {
      if (monitorReads++ > 0) monitorReloaded.resolve()
      return json(monitors)
    }
    if (url.pathname.endsWith("/stop") && request.method === "POST") {
      const monitor = monitors.find((item) => url.pathname.includes(item.id))!
      removed.push(monitor.shellID)
      return json({ ...monitor, status: "ended", reason: "cancelled" })
    }
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
    if (/^\/api\/session\/parent\/monitor\/[^/]+\/output$/.test(url.pathname)) {
      const output = "shard 2 failure\nstderr diagnostic\n"
      const cursor = Math.min(Number(url.searchParams.get("cursor") ?? 0), output.length)
      return json({ output: output.slice(cursor), cursor: output.length, size: output.length, truncated: false })
    }
    if (shellID && request.method === "GET") {
      viewed.push(shellID)
      return json({ location: { directory }, data: shells.find((shell) => shell.id === shellID) })
    }
    if (url.pathname.endsWith("/output")) {
      return json({ location: { directory }, data: { output: "", cursor: 0, size: 0, truncated: false } })
    }
    if (shellID && request.method === "DELETE") {
      removed.push(shellID)
      if (onRemove) return onRemove(shellID)
      return new Response(null, { status: 204 })
    }
  }, events)

  function Content() {
    const data = useData()
    route = useRoute()
    dispatch = Keymap.use().dispatch
    onCleanup(data.on("monitor.ended", () => monitorEnded.resolve()))
    onMount(() => {
      void Promise.all([
        data.session.sync("parent"),
        data.session.sync("child-a"),
        data.session.sync("child-b"),
        data.shell.sync(),
        data.monitor.sync("parent"),
      ])
        .then(() => wait(() => data.session.status("child-a") === "running"))
        .then(() => ready.resolve(), ready.reject)
    })
    return (
      <>
        {focusedTextarea && <textarea focused={true} initialValue="draft" />}
        <Composer sessionID="parent" open={true} defaultTab={defaultTab} onClose={() => closed++} />
        <Toast />
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
      <TestTuiContexts directory={directory}>
        <ConfigProvider config={createTuiResolvedConfig({ keybinds }, { terminal: false })}>
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
    events,
    monitorEnded: monitorEnded.promise,
    monitorReloaded: monitorReloaded.promise,
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

test("stopping a background task shows progress, prevents duplicates, and reports failure", async () => {
  const response = Promise.withResolvers<Response>()
  const composer = await renderComposer("shell", {}, false, [], () => response.promise)
  try {
    composer.dispatch("composer.shell.kill")
    composer.dispatch("composer.shell.kill")
    await composer.app.waitForFrame((frame) => frame.includes("stopping…"))
    expect(composer.removed).toEqual(["sh-a"])
    response.resolve(new Response("Unavailable", { status: 503 }))
    await composer.app.waitForFrame((frame) => frame.includes("Could not stop background task"), { maxPasses: 100 })
    expect(composer.app.captureCharFrame()).toContain("stop ctrl+d")
  } finally {
    response.resolve(new Response(null, { status: 204 }))
    composer.app.renderer.destroy()
  }
})

test.each([48, 100])("background tasks show monitor progress and restart status at %s columns", async (width) => {
  const monitor: MonitorInfo = {
    id: "mon_ci",
    sessionID: "parent",
    shellID: "sh-a",
    description: "CI jobs",
    delivery: "steer",
    log: "/tmp/ci.log",
    startedAt: 1,
    expiresAt: 300001,
    eventCount: 2,
    outputBytes: 30,
    status: "running",
  }
  const composer = await renderComposer("shell", {}, false, [monitor])
  try {
    composer.app.resize(width, 20)
    await composer.app.renderOnce()
    const frame = composer.app.captureCharFrame()
    expect(frame).toContain("Background")
    expect(frame).toContain("Monitor · CI jobs")
    expect(frame).toContain("2 events · running")
    expect(frame).toContain("started")
    expect(frame).toContain("expires")
    expect(frame).not.toContain("bun test")
    composer.dispatch("composer.shell.kill")
    await composer.app.waitFor(() => composer.removed.length === 1)
    expect(composer.removed).toEqual([monitor.shellID])
    composer.events.emit({
      id: "evt_monitor_end",
      created: 4,
      type: "monitor.ended",
      data: { info: { ...monitor, status: "ended", reason: "server_restarted", eventCount: 3 } },
    })
    await composer.monitorEnded
    await composer.app.waitForFrame((frame) => frame.includes("ended: server restarted"))
    expect(composer.app.captureCharFrame()).toContain("3 events")
    composer.events.emit({
      id: "evt_shell_exit",
      created: 5,
      type: "shell.exited",
      location: { directory },
      data: { id: monitor.shellID, status: "exited", exit: 1 },
    })
    await composer.app.renderOnce()
    expect(composer.app.captureCharFrame()).toContain("output")
    composer.dispatch("composer.shell.select")
    await composer.app.waitForFrame((frame) => frame.includes("Monitor") && frame.includes("stderr diagnostic"))
  } finally {
    composer.app.renderer.destroy()
  }
})

test("reconnecting the TUI reloads monitors ended by a server restart", async () => {
  const monitors: MonitorInfo[] = [
    {
      id: "mon_ci",
      sessionID: "parent",
      shellID: "sh-a",
      description: "CI jobs",
      delivery: "steer",
      log: "/tmp/ci.log",
      startedAt: 1,
      expiresAt: 300001,
      eventCount: 2,
      outputBytes: 30,
      status: "running",
    },
  ]
  const composer = await renderComposer("shell", {}, false, monitors)
  try {
    monitors[0] = { ...monitors[0], status: "ended", reason: "server_restarted" }
    composer.events.disconnect()
    await composer.monitorReloaded
    await composer.app.waitForFrame((frame) => frame.includes("ended: server restarted"))
  } finally {
    composer.app.renderer.destroy()
  }
})

test("configured composer bindings work with a focused textarea", async () => {
  const composer = await renderComposer("subagents", { "composer.shell.kill": "ctrl+u" }, true)
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
  const composer = await renderComposer("shell", { "composer.shell.select": "ctrl+o" }, true)
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
