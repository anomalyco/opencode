import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_plugin_hooks",
  title: "Plugin hooks",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const model = { providerID: "fixture", id: "fixture" }
// Newest first, as the server pages them.
const messages = [
  {
    type: "assistant",
    id: "msg_reply",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 2, completed: 3 },
    // 2,000 tokens of a 8,000-token window.
    tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 800, write: 0 } },
    content: [
      { type: "reasoning", text: "Weighing the parser fix", time: { created: 2, completed: 2 } },
      {
        type: "tool",
        id: "call_shell",
        name: "bash",
        time: { created: 2, completed: 3 },
        state: {
          status: "completed",
          input: { command: "bun test parser" },
          content: [{ type: "text", text: "1 pass" }],
          metadata: {},
        },
      },
      { type: "text", text: "The **parser** is fixed.\n\n```probe\nanything\n```" },
    ],
  },
  { type: "user", id: "msg_ask", text: "Fix the parser", time: { created: 1 } },
]
const goal = {
  id: "goal",
  objective: "Ship the parser",
  status: "active",
  rounds: 1,
  maxRounds: 50,
  boot: "boot",
  updatedAt: 0,
}

async function openSession(plugin: string) {
  const fixture = await copyPlugin(plugin)
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false }, plugins: [fixture.directory] },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages, cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/model")
        return json({
          location: { directory, project: { id: "proj_test", directory, canonical: directory } },
          data: [{ ...model, name: "Fixture", variants: [], limit: { context: 8000, output: 1000 } }],
        })
      if (url.pathname === "/api/rpc/opencode.goal/get") return json({ output: goal })
      return undefined
    },
  })
  const dispose = setup[Symbol.asyncDispose]
  return Object.assign(setup, {
    async [Symbol.asyncDispose]() {
      await dispose()
      await fixture[Symbol.asyncDispose]()
    },
  })
}

test("a plugin reads a session's context usage, goal and parts, and renders host markdown", async () => {
  await using app = await openSession("session-reads")
  await app.ready
  // part.get resolves text parts by ordinal; ui.Markdown conceals the markup and runs registered fence renderers.
  const frame = await waitForHighlightedFrame(
    app,
    (frame) =>
      frame.includes("usage 2000 of 8000 (25%)") &&
      frame.includes("goal Ship the parser [active]") &&
      frame.includes("Read text:0: The parser is fixed.") &&
      frame.includes("Probe fence rendered"),
  )
  expect(frame).not.toContain("**parser**")
  expect(frame).not.toContain("```")

  // The goal follows the goal plugin's changes.
  app.events.emit({
    id: "evt_goal_changed",
    created: 4,
    type: "rpc.opencode.goal.changed",
    location: { directory },
    data: { sessionID: session.id, goal: { ...goal, status: "paused" } },
  })
  await app.waitForFrame((frame) => frame.includes("goal Ship the parser [paused]"))
  app.events.emit({
    id: "evt_goal_cleared",
    created: 5,
    type: "rpc.opencode.goal.changed",
    location: { directory },
    data: { sessionID: session.id, goal: null },
  })
  await app.waitForFrame((frame) => frame.includes("goal none [none]"))
})

test("a plugin renders one tool by canonical name and sets transcript defaults", async () => {
  await using app = await openSession("tool-renderer")
  await app.ready
  // `bash` is the shell tool's canonical name; grouping "none" keeps the call its own row.
  // thinking "show" expands reasoning the host hides by default.
  await waitForHighlightedFrame(
    app,
    (frame) =>
      frame.includes("Custom shell row: bun test parser") &&
      frame.includes("Weighing the parser fix") &&
      frame.includes("The parser is fixed."),
  )
})

test("the user's transcript config wins over a plugin's defaults", async () => {
  const fixture = await copyPlugin("tool-renderer")
  try {
    await using app = await createAppFixture({
      width: 100,
      height: 30,
      config: {
        animations: false,
        tabs: { enabled: false },
        plugins: [fixture.directory],
        session: { thinking: "hide" },
      },
      args: { sessionID: session.id },
      fetch: (url) => {
        if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages, cursor: {} })
        if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname)) return json({ data: [] })
        return undefined
      },
    })
    await app.ready
    const frame = await app.waitForFrame((frame) => frame.includes("Custom shell row: bun test parser"))
    expect(frame).not.toContain("Weighing the parser fix")
  } finally {
    await fixture[Symbol.asyncDispose]()
  }
})

test("a plugin claims the transcript's header, first row, user prompt and turn footer", async () => {
  await using app = await openSession("transcript-chrome")
  await app.ready
  const frame = await waitForHighlightedFrame(
    app,
    (frame) =>
      frame.includes("Header claimed") &&
      frame.includes("Transcript start claimed") &&
      frame.includes("User band: Fix the parser") &&
      frame.includes("The parser is fixed.") &&
      frame.includes("Footer for msg_reply"),
  )
  const lines = frame.split("\n")
  // inset 1 starts rows one cell in.
  expect(lines.find((line) => line.includes("User band"))).toStartWith(" User band")
  // rowGap 0 for the footer puts it straight under the reply; every other row keeps one blank row above it.
  const footer = lines.findIndex((line) => line.includes("Footer for msg_reply"))
  expect(lines[footer - 1]).toContain("anything")
  const user = lines.findIndex((line) => line.includes("User band"))
  expect(lines[user - 1]?.trim()).toBe("")
  // The band composer puts its prefix before the editor. Its bar is still drawn, in the band's colour.
  expect(lines.some((line) => line.startsWith(" ┃> "))).toBe(true)
})
