import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { formatHandoff } from "./handoff"
import { latestReply, readLines } from "./messages"

const assistant = (id: string, ...texts: string[]): SessionMessageInfo => ({
  id,
  type: "assistant",
  time: { created: 1, completed: 2 },
  agent: "build",
  model: { id: "fixture", providerID: "fixture" },
  content: [
    { type: "reasoning", text: "private reasoning" },
    ...texts.map((text) => ({ type: "text" as const, text })),
    {
      type: "tool",
      id: `tool_${id}`,
      name: "read",
      time: { created: 1 },
      state: {
        status: "completed",
        input: { path: "/private/file" },
        content: [{ type: "text", text: "file contents" }],
      },
    },
  ],
})

test("a read gives the newest reply whole and older messages as excerpts that name the message to read on", () => {
  const messages: SessionMessageInfo[] = [
    { id: "msg_old", type: "user", time: { created: 1 }, text: "u".repeat(450) },
    assistant("msg_old_reply", "o".repeat(450)),
    { id: "msg_idle", type: "idle", time: { created: 2 }, outcome: "succeeded" },
    {
      id: "msg_voice",
      type: "user",
      time: { created: 3 },
      text: formatHandoff({ instruction: "Summarise the logs", transcript: ["user: summarise"], full: true }),
    },
    {
      id: "msg_shell",
      type: "shell",
      shellID: "sh_test",
      command: "echo private",
      status: "exited",
      time: { created: 4 },
    },
    assistant("msg_reply", "a".repeat(450), "b".repeat(450)),
  ]

  expect(readLines(messages, 8)).toEqual([
    `user: ${"u".repeat(400)}… [truncated: 50 more characters; call read_session with message_id "msg_old" to read all]`,
    `assistant: ${"o".repeat(400)}… [truncated: 50 more characters; call read_session with message_id "msg_old_reply" to read all]`,
    "user: Summarise the logs",
    `assistant: ${"a".repeat(450)}\n\n${"b".repeat(450)}`,
  ])
  expect(readLines(messages, 2)).toHaveLength(2)
  expect(latestReply(messages, "msg_voice")).toBe(`${"a".repeat(450)}\n\n${"b".repeat(450)}`)
  expect(latestReply(messages, "msg_unknown")).toBeUndefined()
})
