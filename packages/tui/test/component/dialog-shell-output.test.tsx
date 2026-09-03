/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { ShellInfo } from "@opencode-ai/client"
import { expect, test } from "bun:test"
import { createSignal, onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { Keymap } from "../../src/context/keymap"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { Composer } from "../../src/routes/session/composer"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function setup(width: number, output = "") {
  const temporary = await tmpdir()
  const location = { directory: `${temporary.path}/original`, workspaceID: "workspace_fixture" }
  const shell: ShellInfo = {
    id: "sh_fixture",
    command: "render-scene --quality high",
    cwd: location.directory,
    shell: "/bin/sh",
    file: `${temporary.path}/capture.out`,
    status: "running",
    metadata: { sessionID: "ses_fixture" },
    time: { started: 0 },
  }
  const state = { output, missing: false, failure: false }
  const requests: { url: URL; method: string }[] = []
  const events = createEventStream()
  const envelope = (data: unknown) => json({ location, data })
  const api = createApi(
    createFetch((url, request) => {
      if (!url.pathname.startsWith("/api/shell")) return undefined
      requests.push({ url, method: request.method })
      if (url.pathname === "/api/shell") return envelope([shell])
      if (state.missing)
        return json({ _tag: "ShellNotFoundError", id: shell.id, message: "Shell not found" }, { status: 404 })
      if (state.failure) return new Response("Unavailable", { status: 503 })
      if (url.pathname === `/api/shell/${shell.id}`) return envelope(shell)
      const bytes = Buffer.from(state.output)
      const cursor = Math.min(Number(url.searchParams.get("cursor") ?? 0), bytes.length)
      const end = Math.min(cursor + Number(url.searchParams.get("limit") ?? 65536), bytes.length)
      return envelope({
        output: bytes.subarray(cursor, end).toString(),
        cursor: end,
        size: bytes.length,
        truncated: false,
      })
    }, events).fetch,
  )

  function Shells() {
    const data = useData()
    const [open, setOpen] = createSignal(true)
    onMount(() => void data.shell.sync(location))
    return <Composer sessionID="ses_fixture" open={open()} defaultTab="shell" onClose={() => setOpen(false)} />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig({ session: { terminal: false } })}>
          <RouteProvider initialRoute={{ type: "session", sessionID: "ses_fixture" }}>
            <ClientProvider api={api}>
              <DataProvider directory={temporary.path}>
                <ThemeProvider mode={width === 40 ? "light" : "dark"} source={emptyThemeSource}>
                  <Keymap.Provider>
                    <ToastProvider>
                      <DialogProvider>
                        <Shells />
                      </DialogProvider>
                    </ToastProvider>
                  </Keymap.Provider>
                </ThemeProvider>
              </DataProvider>
            </ClientProvider>
          </RouteProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes(shell.command))
  return {
    ...app,
    state,
    shell,
    location,
    requests,
    events,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

test.each([40, 100])("shell output opens, follows, scrolls, and survives exit at %s columns", async (width) => {
  await using app = await setup(width, Array.from({ length: 50 }, (_, i) => `Frame ${i + 1}\n`).join(""))
  expect(app.captureCharFrame()).toContain("output")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Shell output") && frame.includes("Frame 50"))
  const scroll = app.renderer.root.findDescendantById("shell-output-scroll")
  if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Output scrollbox missing")
  expect(scroll.scrollTop).toBeGreaterThan(0)

  app.mockInput.pressKey("HOME")
  await app.waitForFrame((frame) => frame.includes("Frame 1\n") || /Frame 1\s/.test(frame))
  expect(scroll.scrollTop).toBe(0)
  app.state.output += "Frame 51\n"
  await app.waitFor(
    () =>
      app.requests.some(
        (request) => request.url.searchParams.get("cursor") === String(Buffer.byteLength(app.state.output)),
      ),
    { maxPasses: 150 },
  )
  expect(scroll.scrollTop).toBe(0)
  app.mockInput.pressKey("END")
  await app.waitForFrame((frame) => frame.includes("Frame 51"))
  app.state.output += "\u001b[32mRender complete\u001b[0m\r\n"
  app.shell.status = "exited"
  app.shell.exit = 0
  app.events.emit({
    id: "evt_exit",
    created: 0,
    type: "shell.exited",
    location: app.location,
    data: { id: app.shell.id, exit: 0, status: "exited" },
  })
  await app.waitForFrame((frame) => frame.includes("Render complete") && frame.includes("code 0"), { maxPasses: 100 })
  expect(app.captureCharFrame()).not.toContain("[32m")
  expect(app.requests.every((request) => request.method === "GET")).toBe(true)
  const reads = app.requests.filter((request) => request.url.pathname !== "/api/shell")
  expect(reads.every((request) => request.url.searchParams.get("location[directory]") === app.location.directory)).toBe(
    true,
  )
  expect(
    reads.every((request) => request.url.searchParams.get("location[workspace]") === app.location.workspaceID),
  ).toBe(true)

  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Shell output") && frame.includes("No shell commands"))
  const count = app.requests.length
  await Bun.sleep(1100)
  expect(app.requests).toHaveLength(count)
})

test("empty output explains redirection, retries errors, and preserves output after removal", async () => {
  await using app = await setup(100)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("No captured output") && frame.includes("redirected"))
  app.state.failure = true
  await app.waitForFrame((frame) => frame.includes("Retrying"), { maxPasses: 100 })
  app.state.failure = false
  app.state.output = "Recovered output\n"
  await app.waitForFrame((frame) => frame.includes("Recovered output") && !frame.includes("Retrying"), {
    maxPasses: 100,
  })
  app.state.missing = true
  await app.waitForFrame((frame) => frame.includes("no longer available"), { maxPasses: 100 })
  expect(app.captureCharFrame()).toContain("Recovered output")
  const count = app.requests.length
  await Bun.sleep(1100)
  expect(app.requests).toHaveLength(count)
})

test("large captures open at a bounded tail and clicking a shell opens the viewer", async () => {
  await using app = await setup(100, "old output\n".repeat(20000) + "Latest frame\n")
  const row = app
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes(app.shell.command))
  await app.mockMouse.click(6, row)
  await app.waitForFrame((frame) => frame.includes("Latest frame") && frame.includes("Earlier output omitted"))
  const reads = app.requests.filter((request) => request.url.pathname.endsWith("/output"))
  expect(reads[0]?.url.searchParams.get("cursor")).toBe(String(Number.MAX_SAFE_INTEGER))
  expect(reads[1]?.url.searchParams.get("cursor")).toBe(String(Buffer.byteLength(app.state.output) - 65536))
  expect(reads[1]?.url.searchParams.get("limit")).toBe("65536")
})
