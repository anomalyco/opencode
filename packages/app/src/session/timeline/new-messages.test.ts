import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { unseenTimelineParts } from "./new-messages"

const messages = [
  { id: "msg_user", type: "user", text: "Prompt", time: { created: 1 } },
  {
    id: "msg_answer",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 2 },
    content: [
      { type: "text", text: "Seen" },
      { type: "text", text: "New" },
    ],
  },
] satisfies SessionMessageInfo[]

describe("unseenTimelineParts", () => {
  test("includes parts appended to an existing assistant message, not its already seen parts", () => {
    expect([
      ...unseenTimelineParts(messages, { messageID: "msg_answer", created: 2, partID: "msg_answer:text:0" }),
    ]).toEqual(["msg_answer:text:1"])
  })

  test("uses identity rather than timestamps when messages share a millisecond", () => {
    expect([
      ...unseenTimelineParts(
        messages.map((message) => ({ ...message, time: { created: 2 } })),
        { messageID: "msg_user", created: 2 },
      ),
    ]).toEqual(["msg_answer:text:0", "msg_answer:text:1"])
  })

  test("does not mark older parts when the saved part is absent from a refreshed message", () => {
    expect([
      ...unseenTimelineParts(messages, { messageID: "msg_answer", created: 2, partID: "msg_answer:text:2" }),
    ]).toEqual([])
  })

  test("ignores earlier paged history when the cursor is outside the loaded window", () => {
    expect([...unseenTimelineParts(messages, { messageID: "msg_evicted", created: 3 })]).toEqual([])
    expect([...unseenTimelineParts(messages.slice(1), { messageID: "msg_evicted", created: 1 })]).toEqual([
      "msg_answer:text:0",
      "msg_answer:text:1",
    ])
  })
})
