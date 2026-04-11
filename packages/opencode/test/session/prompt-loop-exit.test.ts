import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"

function makeUser(id: string): MessageV2.User {
  return {
    id,
    role: "user",
    sessionID: "session-1",
    time: { created: Date.now() },
    agent: "default",
    model: { providerID: "openai", modelID: "gpt-4" },
  } as MessageV2.User
}

function makeAssistant(
  id: string,
  parentID: string,
  finish?: string,
): MessageV2.Assistant {
  return {
    id,
    role: "assistant",
    sessionID: "session-1",
    parentID,
    mode: "default",
    agent: "default",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "gpt-4",
    providerID: "openai",
    time: { created: Date.now() },
    finish,
  } as MessageV2.Assistant
}

describe("shouldExitLoop", () => {
  test("normal case: user ID < assistant ID, parentID matches, finish=end_turn → exits", () => {
    const user = makeUser("01AAA")
    const assistant = makeAssistant("01BBB", "01AAA", "end_turn")
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(true)
  })

  test("clock skew: user ID > assistant ID, parentID matches, finish=stop → exits", () => {
    // Simulates client clock ahead: user message ID sorts AFTER the assistant ID
    const user = makeUser("01ZZZ")
    const assistant = makeAssistant("01AAA", "01ZZZ", "stop")
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(true)
  })

  test("unfinished assistant: finish=tool-calls → does NOT exit", () => {
    const user = makeUser("01AAA")
    const assistant = makeAssistant("01BBB", "01AAA", "tool-calls")
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(false)
  })

  test("unfinished assistant: finish=unknown → does NOT exit", () => {
    const user = makeUser("01AAA")
    const assistant = makeAssistant("01BBB", "01AAA", "unknown")
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(false)
  })

  test("no assistant yet → does NOT exit", () => {
    const user = makeUser("01AAA")
    expect(SessionPrompt.shouldExitLoop(user, undefined)).toBe(false)
  })

  test("assistant has no finish → does NOT exit", () => {
    const user = makeUser("01AAA")
    const assistant = makeAssistant("01BBB", "01AAA", undefined)
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(false)
  })

  test("parentID mismatch → does NOT exit", () => {
    const user = makeUser("01AAA")
    const assistant = makeAssistant("01BBB", "01OTHER", "end_turn")
    expect(SessionPrompt.shouldExitLoop(user, assistant)).toBe(false)
  })

  test("no user message → does NOT exit", () => {
    const assistant = makeAssistant("01BBB", "01AAA", "end_turn")
    expect(SessionPrompt.shouldExitLoop(undefined, assistant)).toBe(false)
  })
})
