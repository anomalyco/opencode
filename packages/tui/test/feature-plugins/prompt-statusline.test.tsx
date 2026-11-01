/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { ConfigProvider, resolve } from "../../src/config"
import { runStatusline, Statusline, statuslineInput } from "../../src/feature-plugins/prompt/statusline"
import { createAppFixture } from "../fixture/app"
import { json } from "../fixture/tui-client"

const posix = process.platform !== "win32"

const context = {
  location: { directory: "/launch" },
  app: { version: "2.0.0" },
  theme: { text: { muted: RGBA.fromInts(100, 100, 100) } },
  ui: { model: { current: () => ({ providerID: "provider", modelID: "model" }) } },
  data: {
    session: {
      get: () => ({ id: "session", projectID: "project", location: { directory: "/workspace/packages/app" } }),
      cost: () => 1.5,
      message: {
        list: () => [
          {
            id: "message",
            type: "assistant",
            model: { providerID: "provider", id: "model" },
            tokens: { input: 1_000, output: 400, reasoning: 100, cache: { read: 400, write: 100 } },
          },
        ],
      },
    },
    project: { get: () => ({ id: "project", canonical: "/workspace" }) },
    location: {
      model: { list: () => [{ providerID: "provider", id: "model", name: "Model", limit: { context: 10_000 } }] },
    },
  },
} as unknown as Context

test("statusline input uses Claude Code field names", () => {
  expect(statuslineInput(context, "session")).toEqual({
    hook_event_name: "Status",
    session_id: "session",
    cwd: "/workspace/packages/app",
    version: "2.0.0",
    model: { id: "provider/model", display_name: "Model" },
    workspace: { current_dir: "/workspace/packages/app", project_dir: "/workspace" },
    cost: { total_cost_usd: 1.5 },
    context_window: {
      context_window_size: 10_000,
      used_percentage: 20,
      remaining_percentage: 80,
      current_usage: {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 400,
      },
    },
  })
})

test("statusline input without a session falls back to the launch location", () => {
  const input = statuslineInput(context)
  expect(input.session_id).toBeUndefined()
  expect(input.cwd).toBe("/launch")
  expect(input.cost.total_cost_usd).toBe(0)
  expect(input.context_window.used_percentage).toBeUndefined()
})

test("statusline input tolerates a session that does not exist yet", () => {
  const input = statuslineInput(
    {
      ...context,
      data: {
        ...context.data,
        session: {
          get: () => undefined,
          cost: () => {
            throw new Error("Session not found")
          },
          message: {
            list: () => {
              throw new Error("Session not found")
            },
          },
        },
      },
    } as unknown as Context,
    "pending",
  )
  expect(input.session_id).toBe("pending")
  expect(input.cost.total_cost_usd).toBe(0)
})

test.skipIf(!posix)("statusline command reads stdin and returns its first line without ANSI codes", async () => {
  const signal = new AbortController().signal
  expect(await runStatusline({ command: "cat", stdin: '{"a":1}\nignored', signal })).toBe('{"a":1}')
  expect(await runStatusline({ command: "printf '\\033[31mred\\033[0m\\nsecond'", stdin: "{}", signal })).toBe("red")
  expect(await runStatusline({ command: "exit 3", stdin: "{}", signal })).toBe("")
})

test.skipIf(!posix)("statusline command is dropped when aborted", async () => {
  const abort = new AbortController()
  const result = runStatusline({ command: "sleep 5; echo late", stdin: "{}", signal: abort.signal })
  abort.abort()
  expect(await result).toBeUndefined()
})

test.skipIf(!posix)("statusline renders the command output in the footer", async () => {
  const app = await testRender(
    () => (
      <ConfigProvider config={resolve({ statusline: { command: "echo custom status" } }, { terminalSuspend: true })}>
        <Statusline context={context} sessionID="session" />
      </ConfigProvider>
    ),
    { width: 40, height: 2 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("custom status")
    await Bun.sleep(600)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("custom status")
  } finally {
    app.renderer.destroy()
  }
})

test("statusline renders nothing without a command", async () => {
  const app = await testRender(
    () => (
      <ConfigProvider config={resolve({}, { terminalSuspend: true })}>
        <Statusline context={context} sessionID="session" />
      </ConfigProvider>
    ),
    { width: 40, height: 2 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame().trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})

test.skipIf(!posix)("statusline shows in the home prompt footer with the selected model", async () => {
  const location = {
    directory: process.cwd(),
    project: { id: "project", directory: process.cwd(), canonical: process.cwd() },
  }
  await using setup = await createAppFixture({
    config: {
      animations: false,
      statusline: { command: `echo "[$(grep -o '"display_name":"[^"]*"' | cut -d'"' -f4)]"` },
    },
    fetch: async (url) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("[Demo Model]"))
})
