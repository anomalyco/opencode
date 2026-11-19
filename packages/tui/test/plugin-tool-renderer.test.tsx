/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createMemo, createSignal } from "solid-js"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import type { ToolRender } from "@opencode/plugin/tui/context"
import { CustomToolPart } from "../src/routes/session/index"
import { ToastProvider } from "../src/ui/toast"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>

const session = {
  id: "ses_tool_renderer",
  title: "Tool renderer",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const model = { providerID: "fixture", id: "fixture" }
const messages: SessionMessageInfo[] = [
  { type: "user", id: "user-1", text: "Run the fixture", time: { created: 0 } },
  {
    type: "assistant",
    id: "assistant-1",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 1, completed: 3 },
    content: [
      {
        type: "tool",
        id: "call-1",
        name: "FixtureTool",
        time: { created: 1, completed: 2 },
        state: {
          status: "completed",
          input: { label: "hello" },
          content: [{ type: "text", text: "done" }],
          metadata: { label: "hello" },
        },
      },
      { type: "text", text: "Fixture answer" },
    ],
  },
]

test("a plugin tool renderer replaces the built-in view until disposed or the plugin is disabled", async () => {
  await using plugin = await copyPlugin("tool-renderer")
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: session.id },
    config: {
      animations: false,
      plugins: [plugin.directory],
      session: { verbosity: "high", grouping: "none" },
      tabs: { enabled: false },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    },
  })
  await setup.ready
  // Before registration the built-in generic tool view shows.
  await setup.waitForFrame((frame) => frame.includes("Fixture answer") && frame.includes("FixtureTool"))
  expect(setup.captureCharFrame()).not.toContain("Plugin tool")

  setup.mockInput.pressKey("F9")
  await waitForText(setup, (frame) => frame.includes("Plugin tool completed hello"))

  // Calling the returned dispose brings the built-in view back.
  setup.mockInput.pressKey("F10")
  await waitForText(setup, (frame) => frame.includes("FixtureTool") && !frame.includes("Plugin tool"))

  setup.mockInput.pressKey("F9")
  await waitForText(setup, (frame) => frame.includes("Plugin tool completed hello"))

  // Disabling the plugin clears the registration like a slot claim.
  await openPlugin(setup)
  await setup.waitForFrame((frame) => frame.includes("disable"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("inactive"))
  setup.mockInput.pressEscape()
  await waitForText(setup, (frame) => frame.includes("FixtureTool") && !frame.includes("Plugin tool"))
})

// Registration lands through the plugin store, not a frame, so poll the
// captured frame against a wall-clock deadline (see command-selection).
async function waitForText(setup: Fixture, matches: (frame: string) => boolean) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (matches(setup.captureCharFrame())) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for frame:\n${setup.captureCharFrame()}`)
}

test("a mounted tool renderer tracks part swaps", async () => {
  const render: ToolRender = (input) => {
    const status = createMemo(() => input.part.state.status)
    const label = createMemo(() => {
      const metadata = input.part.state.status === "streaming" ? undefined : input.part.state.metadata
      return typeof metadata?.label === "string" ? metadata.label : ""
    })
    return (
      <text>
        Plugin tool {status()} {label()}
      </text>
    )
  }
  const running: SessionMessageAssistantTool = {
    type: "tool",
    id: "call-1",
    name: "FixtureTool",
    time: { created: 1 },
    state: { status: "running", input: { label: "first" }, metadata: { label: "first" } },
  }
  const completed: SessionMessageAssistantTool = {
    type: "tool",
    id: "call-1",
    name: "FixtureTool",
    time: { created: 1, completed: 2 },
    state: {
      status: "completed",
      input: { label: "second" },
      content: [{ type: "text", text: "done" }],
      metadata: { label: "second" },
    },
  }
  const [part, setPart] = createSignal<SessionMessageAssistantTool>(running)
  await using app = await testRender(
    () => (
      <ToastProvider>
        <CustomToolPart id="fixture.tool-renderer" render={render} part={part()} sessionID={session.id} />
      </ToastProvider>
    ),
    { width: 80, height: 6 },
  )
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Plugin tool running first")

  setPart(completed)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Plugin tool completed second")
  expect(app.captureCharFrame()).not.toContain("running first")
})

test("a throwing tool renderer is contained by its plugin boundary", async () => {
  const part: SessionMessageAssistantTool = {
    type: "tool",
    id: "call-1",
    name: "FixtureTool",
    time: { created: 1 },
    state: { status: "running", input: {}, metadata: {} },
  }
  const render: ToolRender = () => {
    throw new Error("renderer broke")
  }
  await using app = await testRender(
    () => (
      <ToastProvider>
        <text>Transcript still alive</text>
        <CustomToolPart id="fixture.tool-renderer" render={render} part={part} sessionID={session.id} />
      </ToastProvider>
    ),
    { width: 80, height: 6 },
  )
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("Transcript still alive")
  expect(app.captureCharFrame()).not.toContain("FixtureTool")
})

async function openPlugin(setup: Fixture) {
  await setup.mockInput.typeText("/plugins")
  await setup.waitForFrame((frame) => frame.includes("/plugins"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("fixture.tool-renderer"))
  await setup.mockInput.typeText("tool-renderer")
}
