import { expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each([48, 100])("read ranges stay inline and update on completion at %i columns", async (width) => {
  const session = {
    id: "ses_read_range",
    title: "Read ranges",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const read = (id: string, state: SessionMessageAssistantTool["state"]): SessionMessageAssistantTool => ({
    type: "tool",
    id,
    name: "read",
    time: { created: 1 },
    state,
  })
  const messages: SessionMessageInfo[] = [
    { type: "user", id: "msg_user", text: "Read the files", time: { created: 0 } },
    {
      type: "assistant",
      id: "msg_reads",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      time: { created: 1 },
      content: [
        read("read_plain", {
          status: "completed",
          input: { path: "plain.ts" },
          content: [{ type: "text", text: "Read file plain.ts, lines 1-200\n1: first" }],
        }),
        read("read_offset", {
          status: "completed",
          input: { path: "offset.ts", offset: 801 },
          content: [{ type: "text", text: "Read file offset.ts, lines 801-900\n801: first" }],
        }),
        read("read_limit", {
          status: "completed",
          input: { path: "limit.ts", limit: 40 },
          content: [{ type: "text", text: "Read file limit.ts, lines 1-3\n1: first" }],
        }),
        read("read_live", { status: "streaming", input: "" }),
      ],
    },
  ]
  await using app = await createAppFixture({
    width,
    height: 30,
    config: { animations: false, tabs: { mode: "off" }, session: { verbosity: "high", sidebar: "hide" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })
  const initial = await app.waitForFrame((frame) => frame.includes("Read limit.ts:1-3"))
  expect(initial).toContain("Read offset.ts:801-900")
  expect(initial).toContain("Read plain.ts")
  expect(initial).not.toContain("plain.ts:")

  app.events.emit({
    id: "evt_read_called",
    created: 2,
    type: "session.tool.called",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: {
      sessionID: session.id,
      assistantMessageID: "msg_reads",
      id: "read_live",
      input: { path: "live.ts", offset: 120, limit: 40 },
      executed: true,
    },
  })
  await app.waitForFrame((frame) => frame.includes("Read live.ts:120-159"))
  app.events.emit({
    id: "evt_read_success",
    created: 3,
    type: "session.tool.success",
    durable: { aggregateID: session.id, seq: 2, version: 2 },
    data: {
      sessionID: session.id,
      assistantMessageID: "msg_reads",
      id: "read_live",
      content: [{ type: "text", text: "Read file live.ts, lines 120-123\n120: first\n123: last" }],
      executed: true,
    },
  })
  const completed = await app.waitForFrame((frame) => frame.includes("Read live.ts:120-123"))
  expect(completed).not.toContain("live.ts:120-159")
})
