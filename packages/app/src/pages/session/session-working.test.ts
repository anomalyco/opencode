import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { pending, working } from "./session-working"

const user = () =>
  ({
    id: "msg_user",
    sessionID: "ses_1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5.4" },
  }) as Message

const assistant = (time: { created: number; completed?: number }) =>
  ({
    id: "msg_assistant",
    sessionID: "ses_1",
    role: "assistant",
    parentID: "msg_user",
    time,
    agent: "build",
    providerID: "openai",
    modelID: "gpt-5.4",
    model: { providerID: "openai", modelID: "gpt-5.4" },
    mode: "chat",
    parts: [],
    tools: {},
  }) as unknown as AssistantMessage

describe("session-working", () => {
  test("treats only the last incomplete assistant as pending", () => {
    expect(pending([assistant({ created: 1 })])).toBe(true)
    expect(pending([assistant({ created: 1 }), user()])).toBe(false)
    expect(pending([assistant({ created: 1, completed: 2 })])).toBe(false)
  })

  test("prefers explicit non-idle status", () => {
    expect(working({ type: "busy" } as SessionStatus, [assistant({ created: 1, completed: 2 })])).toBe(true)
    expect(working({ type: "retry", attempt: 1, message: "retry", next: 2 } as SessionStatus, [])).toBe(true)
  })

  test("falls back to pending last assistant when status is idle", () => {
    expect(working(undefined, [assistant({ created: 1 })])).toBe(true)
    expect(working(undefined, [assistant({ created: 1 }), user()])).toBe(false)
  })
})
