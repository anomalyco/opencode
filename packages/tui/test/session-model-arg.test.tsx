import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import type { TuiInput } from "../src/app"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

function model(providerID: string, id: string, name: string) {
  return {
    id,
    providerID,
    name,
    api: { id, url: "", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 1_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}

const providers = [
  {
    id: "alpha",
    name: "Alpha",
    source: "config",
    env: [],
    options: {},
    models: { "model-a": model("alpha", "model-a", "Model Alpha") },
  },
  {
    id: "beta",
    name: "Beta",
    source: "config",
    env: [],
    options: {},
    models: { "model-b": model("beta", "model-b", "Model Beta") },
  },
]

const session = {
  id: "ses_test",
  title: "Resumed",
  slug: "resumed",
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 0, updated: 0 },
}

// The session's last user message was sent with alpha/model-a.
const message = {
  info: {
    id: "msg_1",
    sessionID: "ses_test",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "alpha", modelID: "model-a" },
  },
  parts: [{ id: "prt_1", sessionID: "ses_test", messageID: "msg_1", type: "text", text: "hello" }],
}

async function footer(args: TuiInput["args"]) {
  const setup = await createTestRenderer({ width: 120, height: 30, useThread: false })
  const core = await import("@opentui/core")
  await mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", options: {}, permission: [] }])
    if (url.pathname === "/config/providers") return json({ providers, default: { alpha: "model-a" } })
    if (url.pathname === "/provider")
      return json({ all: providers, default: { alpha: "model-a" }, connected: ["alpha", "beta"] })
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/ses_test") return json(session)
    if (url.pathname === "/session/ses_test/message") return json([message])
    if (url.pathname === "/session/ses_test/todo" || url.pathname === "/session/ses_test/diff") return json([])
    return undefined
  }, events)
  const ready = Promise.withResolvers<void>()

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args,
        pluginHost: {
          async start(input) {
            input.runtime.setupSlots(input.api)
            ready.resolve()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready.promise
    const deadline = Date.now() + 10_000
    const read = async (): Promise<string> => {
      await setup.renderOnce()
      const line = setup
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("Build ·"))
      if (line || Date.now() > deadline) return line ?? ""
      await Bun.sleep(50)
      return read()
    }
    const line = await read()
    process.emit("SIGHUP")
    await task
    return line
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

test("resuming a session keeps the model passed with --model", async () => {
  const line = await footer({ sessionID: "ses_test", model: "beta/model-b" })

  expect(line).toContain("Model Beta")
  expect(line).not.toContain("Model Alpha")
})

test("resuming a session without --model uses the session's last model", async () => {
  const line = await footer({ sessionID: "ses_test" })

  expect(line).toContain("Model Alpha")
})
