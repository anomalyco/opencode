import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { pickAction, pickResume, ResumeAbortError, ResumeError } from "../../src/session/auto-resume"

const user = (input: { id: string; sessionID: string; at: number }) =>
  ({
    id: MessageID.make(input.id),
    sessionID: SessionID.make(input.sessionID),
    role: "user",
    time: { created: input.at },
    agent: "default",
    model: { providerID: ProviderID.make("opencode"), modelID: ModelID.make("gpt-5-mini") },
    mode: "build",
  }) as unknown as MessageV2.User

const assistant = (input: {
  id: string
  sessionID: string
  parentID: string
  at: number
  error?: MessageV2.Assistant["error"]
}) =>
  ({
    id: MessageID.make(input.id),
    sessionID: SessionID.make(input.sessionID),
    role: "assistant",
    time: { created: input.at - 1, completed: input.at },
    parentID: MessageID.make(input.parentID),
    modelID: ModelID.make("gpt-5-mini"),
    providerID: ProviderID.make("opencode"),
    mode: "build",
    agent: "default",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...(input.error ? { error: input.error } : {}),
  }) as unknown as MessageV2.Assistant

const tool = (input: { sessionID: string; messageID: string; err?: string }) =>
  ({
    id: PartID.make(`part-${input.messageID}`),
    sessionID: SessionID.make(input.sessionID),
    messageID: MessageID.make(input.messageID),
    type: "tool",
    callID: `call-${input.messageID}`,
    tool: "bash",
    state: {
      status: "error",
      input: {},
      error: input.err ?? ResumeError,
      time: { start: 1, end: 2 },
    },
  }) as unknown as MessageV2.ToolPart

const row = (info: MessageV2.Info, parts: MessageV2.Part[] = []) => ({ info, parts }) as MessageV2.WithParts
const aborted = () => new MessageV2.AbortedError({ message: "The operation was aborted." }).toObject()

describe("session auto resume", () => {
  test("picks interrupted assistant and previous user", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const out = pickResume([row(u1), row(a1, [tool({ sessionID: "ses_1", messageID: a1.id })])])

    expect(out?.assistant.id).toBe(a1.id)
    expect(out?.user.id).toBe(u1.id)
  })

  test("skips when user already followed interrupted assistant", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const u2 = user({ id: "m3", sessionID: "ses_1", at: 3 })
    const out = pickResume([row(u1), row(a1, [tool({ sessionID: "ses_1", messageID: a1.id })]), row(u2)])
    expect(out).toBeUndefined()
  })

  test("skips non-restart tool errors", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const out = pickResume([row(u1), row(a1, [tool({ sessionID: "ses_1", messageID: a1.id, err: "boom" })])])
    expect(out).toBeUndefined()
  })

  test("picks aborted assistant with no tool parts", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2, error: aborted() })
    const out = pickResume([row(u1), row(a1)])
    expect(out?.assistant.id).toBe(a1.id)
    expect(out?.user.id).toBe(u1.id)
  })

  test("picks tool execution aborted errors", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const out = pickResume([
      row(u1),
      row(a1, [tool({ sessionID: "ses_1", messageID: a1.id, err: ResumeAbortError })]),
    ])
    expect(out?.assistant.id).toBe(a1.id)
    expect(out?.user.id).toBe(u1.id)
  })
})

describe("pickAction", () => {
  test("returns unanswered when last message is user", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const action = pickAction([row(u1)])
    expect(action?.type).toBe("unanswered")
    if (action?.type === "unanswered") {
      expect(action.user.id).toBe(u1.id)
    }
  })

  test("returns unanswered even when an interrupted assistant precedes the user", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const u2 = user({ id: "m3", sessionID: "ses_1", at: 3 })
    const action = pickAction([row(u1), row(a1, [tool({ sessionID: "ses_1", messageID: a1.id })]), row(u2)])
    expect(action?.type).toBe("unanswered")
    if (action?.type === "unanswered") {
      expect(action.user.id).toBe(u2.id)
    }
  })

  test("returns interrupted when last message is interrupted assistant", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const action = pickAction([row(u1), row(a1, [tool({ sessionID: "ses_1", messageID: a1.id })])])
    expect(action?.type).toBe("interrupted")
    if (action?.type === "interrupted") {
      expect(action.assistant.id).toBe(a1.id)
      expect(action.user.id).toBe(u1.id)
    }
  })

  test("returns undefined when last assistant completed normally", () => {
    const u1 = user({ id: "m1", sessionID: "ses_1", at: 1 })
    const a1 = assistant({ id: "m2", sessionID: "ses_1", parentID: u1.id, at: 2 })
    const action = pickAction([row(u1), row(a1)])
    expect(action).toBeUndefined()
  })

  test("returns undefined for empty input", () => {
    expect(pickAction([])).toBeUndefined()
  })
})
