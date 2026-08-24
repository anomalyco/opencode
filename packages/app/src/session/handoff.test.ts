import { expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { clearSessionMessageHandoff, getSessionMessageHandoff, setSessionMessageHandoff } from "./handoff"

test("stores and clears a message handoff", () => {
  const message = {
    id: "msg_handoff",
    type: "user",
    text: "",
    files: [{ data: "", mime: "image/png", source: { type: "uri", uri: "blob:image" } }],
    time: { created: 1 },
  } satisfies SessionMessageUser

  setSessionMessageHandoff("session-key", message)
  expect(getSessionMessageHandoff("session-key")).toEqual(message)
  clearSessionMessageHandoff("session-key", message.id)
  expect(getSessionMessageHandoff("session-key")).toBeUndefined()
})
