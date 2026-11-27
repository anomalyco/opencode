import { expect, test } from "bun:test"
import { ScrollBoxRenderable } from "@opentui/core"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

test("a plugin streams and opens child links in a transcript outside the active tab family", async () => {
  await using plugin = await copyPlugin("session-transcript")
  const main = {
    id: `ses_main_${crypto.randomUUID()}`,
    title: "Main session",
    projectID: "proj_transcript",
    location: { directory },
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  } satisfies SessionInfo
  const aside = { ...main, id: "ses_aside", title: "Archived aside", time: { ...main.time, archived: 2 } }
  const child = { ...main, id: "ses_aside_child", title: "Aside subagent", parentID: aside.id }
  const mainPrompt = "Main transcript prompt"
  const asidePrompt = "Aside transcript prompt"
  const asideAnswer = "Aside Markdown answer"
  const childPrompt = "Child transcript prompt"
  const olderPrompt = "Older aside prompt"
  const messages = new Map<string, SessionMessageInfo[]>([
    [main.id, [{ id: "msg_main", type: "user", text: mainPrompt, time: { created: 1 } }]],
    [
      aside.id,
      [
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `msg_history_${index}`,
          type: "user" as const,
          text: `History prompt ${index}`,
          time: { created: 1 },
        })),
        { id: "msg_aside", type: "user", text: asidePrompt, time: { created: 1 } },
        {
          id: "msg_aside_reply",
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "model" },
          content: [{ type: "text", text: `**${asideAnswer}**` }],
          time: { created: 2, completed: 3 },
        },
        {
          id: "msg_aside_notice",
          type: "synthetic",
          text: "Child finished",
          description: "Read the child transcript",
          metadata: { source: "subagent", childID: child.id, agent: "general", state: "completed" },
          time: { created: 4 },
        },
      ],
    ],
    [child.id, [{ id: "msg_child", type: "user", text: childPrompt, time: { created: 5 } }]],
  ])
  await using setup = await createAppFixture({
    width: 160,
    height: 30,
    args: { sessionID: main.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      session: { sidebar: "hide" },
      plugins: [{ package: plugin.directory, options: { sessionID: aside.id } }],
    },
    fetch: (url) => {
      for (const session of [main, aside, child]) {
        const route = `/api/session/${session.id}`
        if (url.pathname === route) return json({ data: session })
        if (url.pathname === `${route}/inbox`) return json({ data: [] })
        if (url.pathname !== `${route}/message`) continue
        if (session === aside && url.searchParams.get("cursor") === "older") {
          return json({
            data: [{ id: "msg_older", type: "user", text: olderPrompt, time: { created: 0 } }],
            cursor: {},
          })
        }
        return json({
          data: messages.get(session.id)?.toReversed() ?? [],
          cursor: session === aside ? { next: "older" } : {},
        })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(mainPrompt))

  setup.mockInput.pressKey("F7")
  await waitForHighlightedFrame(setup, (frame) => frame.includes(asidePrompt) && frame.includes(asideAnswer))
  const panel = setup.renderer.root.findDescendantById("session-panel")
  expect(panel?.findDescendantById("msg_aside")).toBeDefined()
  expect(panel?.findDescendantById("msg_aside_reply")).toBeDefined()
  expect(panel?.findDescendantById("msg_main")).toBeUndefined()
  expect(setup.captureCharFrame()).toContain(mainPrompt)

  async function click(text: string, frame = setup.captureCharFrame()) {
    const lines = frame.split("\n")
    const y = lines.findIndex((line) => line.includes(text))
    expect(y).toBeGreaterThanOrEqual(0)
    await setup.mockMouse.click(lines[y].indexOf(text) + 1, y)
  }

  const history = panel?.findDescendantById("transcript-older")?.parent
  if (!(history instanceof ScrollBoxRenderable)) throw new Error("Missing aside scrollbox")
  expect(history.scrollTop).toBeGreaterThan(0)
  history.scrollTo(0)
  await setup.waitForFrame((frame) => frame.includes("Load older messages"))
  await click("Load older messages")
  await setup.waitFor(() => panel?.findDescendantById("msg_older") !== undefined)
  // Wait for pinAbove's afterLayout anchor to settle before scrolling to the top.
  await setup.renderOnce()
  history.scrollTo(0)
  await setup.waitForFrame((frame) => frame.includes(olderPrompt) && frame.includes("Jump to latest"))

  setup.events.emit({
    id: "evt_aside_step",
    created: 6,
    type: "session.step.started",
    durable: { aggregateID: aside.id, seq: 1, version: 1 },
    data: {
      sessionID: aside.id,
      assistantMessageID: "msg_aside_live",
      agent: "build",
      model: { providerID: "fixture", id: "model" },
      started: 6,
    },
  })
  setup.events.emit({
    id: "evt_aside_text",
    created: 7,
    type: "session.text.started",
    durable: { aggregateID: aside.id, seq: 2, version: 1 },
    data: { sessionID: aside.id, assistantMessageID: "msg_aside_live", ordinal: 0 },
  })
  setup.events.emit({
    id: "evt_aside_delta",
    created: 8,
    type: "session.text.delta",
    data: { sessionID: aside.id, assistantMessageID: "msg_aside_live", ordinal: 0, delta: "Live aside output" },
  })
  await setup.waitFor(() => panel?.findDescendantById("msg_aside_live") !== undefined)
  expect(setup.captureCharFrame()).not.toContain("Live aside output")
  await click("Jump to latest")
  const frame = await waitForHighlightedFrame(setup, (frame) => frame.includes("Live aside output"))
  expect(frame).toContain(mainPrompt)
  expect(history.scrollTop).toBe(history.scrollHeight - history.viewport.height)
  await click("General finished", frame)
  await setup.waitForFrame((frame) => frame.includes(childPrompt) && frame.includes(mainPrompt))
  expect(panel?.findDescendantById("msg_child")).toBeDefined()
  expect(panel?.findDescendantById("msg_aside")).toBeUndefined()
})
