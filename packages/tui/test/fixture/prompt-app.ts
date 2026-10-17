import { mock } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture"
import { createTuiResolvedConfig } from "./tui-runtime"
import { createEventSource, createFetch, directory, json } from "./tui-sdk"

const sessionID = "ses_prompt_app"
const session = {
  id: sessionID,
  title: "Prompt app",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

export async function wait(fn: () => boolean, timeout = 10_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

export type PromptRig = {
  press(bytes: string): Promise<void>
  click(x: number, y: number): Promise<void>
  frame(): string
  text(): string
  parts(): number
  paths: string[]
  sent: string[]
}

// Runs the TUI in a session whose turn is running, and hands the test its prompt to type and click in.
export async function withPrompt(
  body: (rig: PromptRig) => Promise<void>,
  options?: { height?: number; config?: Parameters<typeof createTuiResolvedConfig>[0]; kv?: Record<string, unknown> },
) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, JSON.stringify(options?.kv ?? {}))
  const setup = await createTestRenderer({ width: 120, height: options?.height ?? 24, useThread: false })
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
        config: createTuiResolvedConfig({ plugin_enabled: {}, ...options?.config }),
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
    await body({
      press,
      async click(x, y) {
        await setup.mockMouse.click(x, y)
        await Bun.sleep(30)
        await render()
      },
      frame: () => setup.captureCharFrame(),
      text,
      parts: () => editor()?.extmarks.getVirtual().length ?? 0,
      paths,
      sent,
    })
    api.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

