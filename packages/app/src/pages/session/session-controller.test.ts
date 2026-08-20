import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import { createRoot, createSignal } from "solid-js"
import {
  normalizeSessionTab,
  normalizeSessionTabs,
  selectSessionUserMessages,
  selectVisibleSessionUserMessages,
} from "./session-domain"
import { createSessionOwnership } from "./session-ownership"

const user = (id: string): SessionMessageUser => ({
  id,
  type: "user",
  text: id,
  time: { created: 0 },
})

const assistant: SessionMessageAssistant = {
  id: "msg_2",
  type: "assistant",
  time: { created: 0 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
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
    const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b"), user("msg_c")]
    const users = selectSessionUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_a", "msg_b", "msg_c"])
    expect(selectVisibleSessionUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_a"])
    expect(selectVisibleSessionUserMessages(users.slice(2), "msg_b")).toEqual([])
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
