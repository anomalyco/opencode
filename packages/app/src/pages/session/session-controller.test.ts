import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@/types"
import { createRoot, createSignal } from "solid-js"
import {
  normalizeSessionTab,
  normalizeSessionTabs,
  selectSessionUserMessages,
  selectVisibleSessionUserMessages,
} from "./session-domain"
import { createSessionOwnership } from "./session-ownership"

const user = (id: string): UserMessage => ({
  id,
  sessionID: "session",
  role: "user",
  time: { created: 0 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
})

const assistant: AssistantMessage = {
  id: "msg_2",
  sessionID: "session",
  role: "assistant",
  time: { created: 0 },
  parentID: "msg_1",
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/workspace", root: "/workspace" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

describe("session controller invariants", () => {
  test("normalizes file tabs once while preserving non-file tabs and order", () => {
    const normalize = (tab: string) => normalizeSessionTab(tab, (value) => value.toLowerCase())

    expect(normalizeSessionTabs(["review", "file://SRC/A.TS", "file://src/a.ts", "context"], normalize)).toEqual([
      "review",
      "file://src/a.ts",
      "context",
    ])
  })

  test("selects user history strictly before the revert boundary", () => {
    const messages: Message[] = [user("msg_z"), assistant, user("msg_b"), user("msg_c")]
    const users = selectSessionUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_z", "msg_b", "msg_c"])
    expect(selectVisibleSessionUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_z"])
    expect(selectVisibleSessionUserMessages(users)).toBe(users)
  })

  test("rejects work captured by a previous session", () => {
    createRoot((dispose) => {
      const [key, setKey] = createSignal("session-a")
      const ownership = createSessionOwnership(key)
      const captured = ownership.capture()
      let ran = false

      setKey("session-b")

      expect(captured.current()).toBe(false)
      expect(captured.run(() => (ran = true))).toBeUndefined()
      expect(ran).toBe(false)
      dispose()
    })
  })
})
