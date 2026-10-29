import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_prompt_undo"
const session = {
  id: sessionID,
  title: "Prompt undo",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

// Upstream's default undo and redo keys, as a kitty-protocol terminal sends them.
const UNDO = "\x1b[45;5u"
const REDO = "\x1b[46;5u"
const CTRL_U = "\x15"
const CTRL_W = "\x17"

async function wait(fn: () => boolean, timeout = 10_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

// Runs the TUI in a session whose turn is running, and hands the test a way to type into its prompt.
async function withPrompt(
  body: (rig: { press(bytes: string): Promise<void>; text(): string; parts(): number; paths: string[]; sent: string[] }) => Promise<void>,
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await createTestRenderer({ width: 120, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const paths: string[] = []
  const sent: string[] = []
  const calls = createFetch((url) => {
    paths.push(url.pathname)
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/status") return json({ [sessionID]: { type: "busy" } })
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return url.searchParams.has("limit") ? json([]) : json({})
    if (url.pathname.startsWith(`/session/${sessionID}/message/`))
      return json({ name: "NotFoundError", data: { message: "Message not found" } }, { status: 404 })
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: [], options: {}, hidden: false }])
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: model.providerID,
            name: "Test",
            source: "config",
            env: [],
            options: {},
            models: { [model.modelID]: { id: model.modelID, name: "Model", providerID: model.providerID } },
          },
        ],
        default: { [model.providerID]: model.modelID },
      })
  })
  const started = Promise.withResolvers<TuiPluginApi>()
  const { run } = await import("../../src/app")
  const render = async () => {
    await setup.renderOnce()
    await setup.renderOnce()
  }

  try {
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (input instanceof Request && input.method === "POST" && input.url.endsWith("/message"))
            sent.push(await input.clone().text())
          return calls.fetch(input, init)
        }) as typeof fetch,
        events: createEventSource().source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            input.runtime.setupSlots(input.api)
            started.resolve(input.api)
          },
          async dispose() {},
        },
      }).pipe(
        Effect.provide(
          Global.layerWith({
            home: tmp.path,
            data: tmp.path,
            cache: tmp.path,
            config: tmp.path,
            state: tmp.path,
            tmp: tmp.path,
            bin: tmp.path,
            log: tmp.path,
            repos: tmp.path,
          }),
        ),
      ),
    )

    const api = await started.promise
    // The prompt is the focused editor; its placeholders are its virtual extmarks.
    const editor = () => {
      const focused = setup.renderer.currentFocusedEditor
      return focused instanceof TextareaRenderable ? focused : undefined
    }
    await wait(() => {
      void render()
      return Boolean(editor())
    })
    const press = async (bytes: string) => {
      setup.renderer.stdin.emit("data", Buffer.from(bytes))
      await Bun.sleep(30)
      await render()
    }
    // The prompt keeps its text across a remount, and so across the tests in this file.
    const text = () => editor()?.plainText ?? ""
    if (text()) await press("\x03")
    await body({ press, text, parts: () => editor()?.extmarks.getVirtual().length ?? 0, paths, sent })
    api.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

test("undo brings back a line deleted with ctrl+u, then the typing before it word by word", async () => {
  await withPrompt(async (rig) => {
    for (const char of "hello brave world") await rig.press(char)
    await rig.press(CTRL_U)
    expect(rig.text()).toBe("")
    await rig.press(UNDO)
    expect(rig.text()).toBe("hello brave world")
    await rig.press(UNDO)
    expect(rig.text()).toBe("hello brave ")
    await rig.press(REDO)
    expect(rig.text()).toBe("hello brave world")
  })
})

test("undo after deleting a paste placeholder restores it with its pasted text", async () => {
  await withPrompt(async (rig) => {
    for (const char of "see ") await rig.press(char)
    await rig.press("\x1b[200~one\ntwo\nthree\x1b[201~")
    expect(rig.text()).toBe("see [Pasted ~3 lines] ")
    expect(rig.parts()).toBe(1)
    await rig.press("\x7f") // backspace the space after it
    await rig.press(CTRL_W)
    expect(rig.text()).toBe("see ")
    expect(rig.parts()).toBe(0)
    await rig.press(UNDO)
    expect(rig.text()).toBe("see [Pasted ~3 lines]")
    expect(rig.parts()).toBe(1)
    await rig.press("\r")
    await wait(() => rig.sent.length > 0)
    expect(rig.sent[0]).toContain(JSON.stringify("see one\ntwo\nthree"))
  })
})

test("undo after a submit brings back what was sent without aborting the running turn", async () => {
  await withPrompt(async (rig) => {
    for (const char of "second prompt") await rig.press(char)
    await rig.press("\r")
    await wait(() => rig.text() === "")
    await rig.press(UNDO)
    expect(rig.text()).toBe("second prompt")
    expect(rig.paths.some((path) => path.endsWith("/abort"))).toBe(false)
    await rig.press(REDO)
    expect(rig.text()).toBe("")
  })
})
