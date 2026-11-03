import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { messageExcerpts } from "./messages"

test("voice reads cap each message at 400 characters and exclude non-conversational content", () => {
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", time: { created: 1 }, text: "u".repeat(401), metadata: { private: "metadata" } },
    { id: "msg_synthetic", type: "synthetic", time: { created: 2 }, text: "s".repeat(401) },
    {
      id: "msg_assistant",
      type: "assistant",
      time: { created: 3, completed: 4 },
      agent: "build",
      model: { id: "fixture", providerID: "fixture" },
      content: [
        { type: "reasoning", text: "private reasoning" },
        { type: "text", text: "a".repeat(200), native: { private: "provider metadata" } },
        {
          type: "tool",
          id: "tool_read",
          name: "read",
          time: { created: 3 },
          state: {
            status: "completed",
            input: { path: "/private/file" },
            content: [{ type: "text", text: "file contents" }],
          },
        },
        { type: "text", text: "b".repeat(300) },
      ],
    },
    {
      id: "msg_shell",
      type: "shell",
      shellID: "sh_test",
      command: "echo private",
      status: "exited",
      time: { created: 5 },
    },
    { id: "msg_idle", type: "idle", time: { created: 6 }, outcome: "succeeded" },
    { id: "msg_short", type: "user", time: { created: 7 }, text: "A short question" },
  ]
  expect(messageExcerpts(messages)).toEqual([
    { id: "msg_user", role: "user", text: "u".repeat(400) },
    { id: "msg_synthetic", role: "synthetic", text: "s".repeat(400) },
    { id: "msg_assistant", role: "assistant", text: "a".repeat(200) + "\n" + "b".repeat(199) },
    { id: "msg_short", role: "user", text: "A short question" },
  ])
})
