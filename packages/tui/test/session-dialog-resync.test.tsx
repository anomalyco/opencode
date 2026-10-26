import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// Regression: a dialog opened from a transcript row outlives that row. A reconnect
// resync keeps only the newest page, dropping the row's message before the rows
// rebuild. The dialog must not read the row's narrowed props.

const session = {
  id: "ses_dialog_resync",
  title: "Dialog resync",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const execute = {
  type: "tool",
  id: "call_execute",
  name: "execute",
  time: { created: 1, completed: 2 },
  state: {
    status: "completed",
    input: { code: "return 1" },
    content: [{ type: "text", text: '{"ok":true}' }],
    metadata: {},
  },
}
const messages = Array.from({ length: 30 }, (_, i) => {
  const turn = String(i).padStart(2, "0")
  return [
    { type: "user", id: `msg_${turn}_a`, text: `Turn ${turn} prompt`, time: { created: i * 10 } },
    {
      type: "assistant",
      id: `msg_${turn}_b`,
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: i * 10 + 1, completed: i * 10 + 2 },
      content: i === 0 ? [execute] : [{ type: "text", text: `Turn ${turn} answer` }],
    },
  ]
})
  .flat()
  .toReversed() as SessionMessageInfo[]

async function openDialogThenResync(target: string, dialog: string) {
  let firstPages = 0
  const resync = Promise.withResolvers<void>()
  await using setup = await createAppFixture({
    width: 112,
    height: 34,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname !== `/api/session/${session.id}/message`) return
      const start = Number(url.searchParams.get("cursor") ?? 0)
      const end = start + Number(url.searchParams.get("limit"))
      if (start === 0 && ++firstPages === 2) resync.resolve()
      return json({ data: messages.slice(start, end), cursor: end < messages.length ? { next: String(end) } : {} })
    },
  })
  await setup.waitForFrame((frame) => frame.includes("Turn 29 prompt"))
  // Jumping to the first message loads every older page into the store.
  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes(target))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  const lines = setup.captureCharFrame().split("\n")
  const row = lines.findIndex((line) => line.includes(target))
  await setup.mockMouse.click(lines[row]!.indexOf(target) + 2, row)
  await setup.waitForFrame((frame) => frame.includes(dialog) && frame.includes("Turn 00"))

  setup.events.disconnect()
  await resync.promise
  // Older rows leave once the newest page is published, or the app crashes.
  await setup.waitForFrame((frame) => !frame.includes("Turn 00"))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  return setup.captureCharFrame()
}

test("message actions dialog survives a resync that drops its message", async () => {
  const frame = await openDialogThenResync("Turn 00 prompt", "Message Actions")
  expect(frame).not.toContain("Stale read")
  expect(frame).toContain("Message Actions")
}, 20000)

test("execute dialog keeps its last state after a resync drops its message", async () => {
  const frame = await openDialogThenResync("execute", "copy code")
  expect(frame).not.toContain("Stale read")
  expect(frame).toContain("return 1")
  expect(frame).toContain("Completed")
}, 20000)
