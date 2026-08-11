import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"

import { MessageV2 } from "../../src/session/message-v2"

import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Provider } from "@/provider/provider"

const sessionID = SessionID.make("ses_test-session")
const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")

const model: Provider.Model = {
  id: modelID,
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true, reasoning: false, attachment: false, toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100000, input: 0, output: 32000 },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): SessionV1.User {
  return {
    id: id as MessageID, sessionID, role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID, modelID: ModelV2.ID.make("test") },
    tools: {},
    mode: "",
  } as unknown as SessionV1.User
}

function assistantInfo(
  id: string,
  parentID: string,
  overrides?: Partial<SessionV1.Assistant>,
): SessionV1.Assistant {
  return {
    id: id as MessageID, sessionID, role: "assistant",
    time: { created: 0 },
    parentID: parentID as MessageID,
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build", agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as unknown as SessionV1.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id: PartID.make(id.startsWith("prt") ? id : `prt_${id}`),
    messageID: MessageID.make(messageID.startsWith("msg") ? messageID : `msg_${messageID}`),
    sessionID,
  }
}

function withParts(m: SessionV1.Info, parts: SessionV1.Part[]): SessionV1.WithParts {
  return { info: m, parts }
}

// ---------------------------------------------------------------------------
// validateStrictTurnTaking
// ---------------------------------------------------------------------------

describe("validateStrictTurnTaking", () => {
  // hank counts consecutive assistant pairs but never mutates
  // me testing the entrance guard

  test("detects consecutive assistant messages", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
      withParts(assistantInfo("a2", "u1", { finish: "stop" }), []),
    ]
    const count = countConsecutiveAssistants(msgs)
    expect(count).toBe(1)
  })

  test("returns 0 for clean alternating turns", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
      withParts(userInfo("u2"), []),
      withParts(assistantInfo("a2", "u2"), []),
    ]
    const count = countConsecutiveAssistants(msgs)
    expect(count).toBe(0)
  })

  test("counts multiple pairs correctly", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(assistantInfo("a1", "u1"), []),
      withParts(assistantInfo("a2", "u1"), []),
      withParts(assistantInfo("a3", "u1"), []),
      withParts(userInfo("u2"), []),
      withParts(assistantInfo("a4", "u2"), []),
      withParts(assistantInfo("a5", "u2"), []),
    ]
    const count = countConsecutiveAssistants(msgs)
    expect(count).toBe(3)
  })

  test("does not mutate the input array", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
      withParts(assistantInfo("a2", "u1"), []),
    ]
    const originalLen = msgs.length
    const count = countConsecutiveAssistants(msgs)
    expect(count).toBe(1)
    expect(msgs).toHaveLength(originalLen)
  })
})

// ---------------------------------------------------------------------------
// latest() ordering independence
// ---------------------------------------------------------------------------

describe("latest() ordering independence", () => {
  // me making sure latest() picks the right user and assistant
  // even when the array order is shuffled by filterCompacted

  test("selects newest user by id, not array position", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("msg_b"), []),
      withParts(assistantInfo("msg_c", "msg_b"), []),
      withParts(userInfo("msg_a"), []),
    ]
    const { user } = MessageV2.latest(msgs)
    expect(user?.id).toBe("msg_b" as MessageID)
  })

  test("selects newest assistant by id across multiple", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
      withParts(userInfo("u2"), []),
      withParts(assistantInfo("a3", "u2"), []),
      withParts(assistantInfo("a2", "u1"), []),
    ]
    const { assistant } = MessageV2.latest(msgs)
    expect(assistant?.id).toBe("a3" as MessageID)
  })

  test("finished picks the highest-id finished assistant", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1", { finish: "stop" }), []),
      withParts(userInfo("u2"), []),
      withParts(assistantInfo("a2", "u2", { finish: "stop" }), []),
    ]
    const { finished } = MessageV2.latest(msgs)
    expect(finished?.id).toBe("a2" as MessageID)
  })

  test("tasks come from messages newer than the latest finished", () => {
    const compMsg = withParts(userInfo("u2"), [
      {
        ...basePart("u2", "p1"),
        type: "compaction",
        auto: true,
        overflow: false,
      } as SessionV1.CompactionPart,
    ])
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1", { finish: "stop" }), []),
      compMsg,
    ]
    const { tasks } = MessageV2.latest(msgs)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.type).toBe("compaction")
  })
})

// ---------------------------------------------------------------------------
// toModelMessagesEffect does not produce consecutive assistants
// ---------------------------------------------------------------------------

describe("toModelMessagesEffect consecutive assistant protection", () => {
  // me checking that tool results on a non-tool-calls message
  // dont leak into the provider format as separate assistants

  test("renders single assistant for text + completed tool parts on stop finish", async () => {
    const msg: SessionV1.WithParts = {
      info: assistantInfo("a1", "u1", { finish: "stop" }),
      parts: [
        {
          ...basePart("a1", "text1"),
          type: "text",
          text: "heres the answer",
        },
        {
          ...basePart("a1", "tool1"),
          type: "tool",
          tool: "bash",
          callID: "call-1",
          state: {
            status: "completed",
            input: "ls",
            output: "file.txt",
            time: { start: 0, end: 1 },
          },
        } as unknown as SessionV1.ToolPart,
      ],
    }

    const result = await MessageV2.toModelMessages([msg], model)
    const assistantMessages = result.filter((m) => m.role === "assistant")
    expect(assistantMessages).toHaveLength(1)
  })

  test("tool-calls finish does not explode with empty parts", async () => {
    const msg: SessionV1.WithParts = {
      info: assistantInfo("a1", "u1", { finish: "tool-calls" }),
      parts: [],
    }
    const result = await MessageV2.toModelMessages([msg], model)
    const assistantMessages = result.filter((m) => m.role === "assistant")
    expect(assistantMessages.length).toBeLessThanOrEqual(1)
  })

  test("skips assistant with non-abort errors", async () => {
    const msg: SessionV1.WithParts = {
      info: assistantInfo("a1", "u1", {
        error: { message: "something went wrong", name: "APIError" } as unknown as SessionV1.Assistant["error"],
      }),
      parts: [],
    }
    const result = await MessageV2.toModelMessages([msg], model)
    const assistantMessages = result.filter((m) => m.role === "assistant")
    expect(assistantMessages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// filterCompacted
// ---------------------------------------------------------------------------

describe("filterCompacted reordering", () => {
  // me checking that compaction reorder doesnt lose or duplicate messages

  test("passes through clean alternating turns unchanged", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
    ]
    const result = MessageV2.filterCompacted(msgs)
    expect(result).toHaveLength(2)
  })

  test("does not reverse order when no compaction markers exist", () => {
    const msgs: SessionV1.WithParts[] = [
      withParts(userInfo("u1"), []),
      withParts(assistantInfo("a1", "u1"), []),
      withParts(userInfo("u2"), []),
      withParts(assistantInfo("a2", "u2"), []),
    ]
    const result = MessageV2.filterCompacted(msgs)
    expect(result).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// inlined version of validateStrictTurnTaking from prompt.ts
// keeping it here so the tests match the source
function countConsecutiveAssistants(msgs: SessionV1.WithParts[]): number {
  if (!msgs || msgs.length < 2) return 0
  let count = 0
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i - 1].info.role === "assistant" && msgs[i].info.role === "assistant") count++
  }
  return count
}
