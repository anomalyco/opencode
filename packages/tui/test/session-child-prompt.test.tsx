import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("child sessions submit prompts with their own agent and model", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  void mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const parent = {
    id: "ses_parent",
    slug: "parent",
    projectID: "proj_test",
    directory,
    title: "Parent session",
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const child = {
    id: "ses_child",
    slug: "child",
    projectID: "proj_test",
    directory,
    parentID: parent.id,
    title: "Child session",
    agent: "general",
    model: { providerID: "openai", id: "child-model", variant: "xhigh" },
    version: "0.0.0-test",
    time: { created: 1, updated: 1 },
  }
  const model = (id: string, name: string, variants: Record<string, object> = {}) => ({
    id,
    providerID: "openai",
    api: { id, url: "https://example.com", npm: "@ai-sdk/openai" },
    name,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 8_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants,
  })
  const provider = {
    id: "openai",
    name: "OpenAI",
    source: "custom",
    env: [],
    options: {},
    models: {
      "primary-model": model("primary-model", "Primary Model"),
      "child-model": model("child-model", "Child Model", { xhigh: {} }),
    },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/agent")
      return json([
        {
          name: "build",
          mode: "primary",
          permission: [],
          options: {},
          model: { providerID: "openai", modelID: "primary-model" },
        },
        {
          name: "general",
          mode: "subagent",
          permission: [],
          options: {},
          model: { providerID: "openai", modelID: "child-model" },
        },
      ])
    if (url.pathname === "/config/providers")
      return json({ providers: [provider], default: { openai: "primary-model" } })
    if (url.pathname === "/provider")
      return json({ all: [provider], default: { openai: "primary-model" }, connected: ["openai"] })
    if (url.pathname === "/session") return json([parent, child])
    if (url.pathname === `/session/${child.id}`) return json(child)
    if (url.pathname === `/session/${child.id}/message`) return json([])
    if (url.pathname === `/session/${child.id}/todo` || url.pathname === `/session/${child.id}/diff`) return json([])
    if (url.pathname === "/project/proj_test/directories") return json([{ directory }])
    return undefined
  })
  let prompt: unknown
  const fetch = Object.assign(
    async (input: Parameters<typeof calls.fetch>[0], init?: Parameters<typeof calls.fetch>[1]) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname === `/session/${child.id}/message`) {
        prompt = await request.json()
        return json({})
      }
      return calls.fetch(input, init)
    },
    {
      preconnect: (...args: Parameters<typeof calls.fetch.preconnect>) => calls.fetch.preconnect(...args),
    },
  )
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposeSlots = () => {}
  const events = createEventSource()

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch,
        events: events.source,
        args: { sessionID: child.id },
        pluginHost: {
          async start(input) {
            api = input.api
            disposeSlots = input.runtime.setupSlots(input.api).dispose
            started()
          },
          async dispose() {
            disposeSlots()
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await Promise.race([
      wait(() => setup.renderer.currentFocusedEditor instanceof core.TextareaRenderable),
      task.then(() => {
        throw new Error("app exited before child prompt rendered")
      }),
    ])
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("General")
    expect(frame).toContain("Child Model")
    expect(frame).toContain("OpenAI")
    expect(frame).toContain("xhigh")

    events.emit({
      directory,
      project: "proj_test",
      payload: {
        id: "evt_permission",
        type: "permission.asked",
        properties: {
          id: "per_child",
          sessionID: child.id,
          permission: "bash",
          patterns: ["git status"],
          metadata: {},
          always: [],
        },
      },
    })
    await wait(() => !(setup.renderer.currentFocusedEditor instanceof core.TextareaRenderable))
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Allow once")

    events.emit({
      directory,
      project: "proj_test",
      payload: {
        id: "evt_permission_replied",
        type: "permission.replied",
        properties: { sessionID: child.id, requestID: "per_child", reply: "once" },
      },
    })
    await wait(() => setup.renderer.currentFocusedEditor instanceof core.TextareaRenderable)

    await setup.mockInput.typeText("Continue this task")
    setup.mockInput.pressEnter()
    await wait(() => prompt !== undefined)

    expect(prompt).toMatchObject({
      agent: "general",
      model: { providerID: "openai", modelID: "child-model" },
      variant: "xhigh",
      parts: [{ type: "text", text: "Continue this task" }],
    })

    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
