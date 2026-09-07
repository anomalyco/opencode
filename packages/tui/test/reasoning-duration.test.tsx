import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test("shows reasoning duration as soon as reasoning ends", async () => {
  await using state = await tmpdir()
  const session = {
    id: "ses_reasoning",
    title: "Reasoning duration",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = [
    { id: "user-1", type: "user", text: "Think", time: { created: 0 } },
    {
      id: "assistant-1",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      content: [{ type: "reasoning", text: "Working", time: { created: 1_000 } }],
      time: { created: 1_000 },
    },
  ]
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { enabled: false }, session: { thinking: "hide" } },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      return undefined
    },
  })

  await setup.waitForFrame((frame) => frame.includes("Thinking"))
  expect(setup.captureCharFrame()).not.toContain("5.8s")
  setup.events.emit({
    id: "evt_reasoning_ended",
    created: 6_800,
    type: "session.reasoning.ended",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: {
      sessionID: session.id,
      assistantMessageID: "assistant-1",
      ordinal: 0,
      text: "Working",
    },
  })

  await setup.waitForFrame((frame) => frame.includes("Thought") && frame.includes("5.8s"))
  expect(setup.captureCharFrame()).toContain("Thought · 5.8s")
})
