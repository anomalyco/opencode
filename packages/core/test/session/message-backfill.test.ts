import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionMessageBackfill } from "@opencode-ai/core/session/message-backfill"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const sessionID = SessionSchema.ID.make("ses_legacy_backfill")
const providerID = ProviderV2.ID.make("provider")
const modelID = ProviderV2.ModelID.make("model")
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)

function user(id: string, created: number, parts: SessionLegacy.Part[]): SessionLegacy.WithParts {
  return {
    info: {
      id: SessionLegacy.MessageID.make(id),
      sessionID,
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID, modelID },
    },
    parts,
  }
}

function assistant(id: string, created: number, parts: SessionLegacy.Part[]): SessionLegacy.WithParts {
  return {
    info: {
      id: SessionLegacy.MessageID.make(id),
      sessionID,
      role: "assistant",
      parentID: SessionLegacy.MessageID.make("msg_parent"),
      time: { created, completed: created + 10 },
      providerID,
      modelID,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/work", root: "/tmp/work" },
      cost: 0.12,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    },
    parts,
  }
}

function text(messageID: string, id: string, value: string): SessionLegacy.TextPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "text",
    text: value,
  }
}

function reasoning(messageID: string, id: string, value: string): SessionLegacy.ReasoningPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "reasoning",
    text: value,
    time: { start: 1, end: 2 },
  }
}

function file(messageID: string, id: string): SessionLegacy.FilePart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "file",
    mime: "image/png",
    filename: "image.png",
    url: "data:image/png;base64,AAAA",
    source: { type: "file", path: "/tmp/image.png", text: { value: "@image", start: 0, end: 6 } },
  }
}

function agent(messageID: string, id: string): SessionLegacy.AgentPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "agent",
    name: "reviewer",
    source: { value: "@reviewer", start: 0, end: 9 },
  }
}

function tool(messageID: string, id: string): SessionLegacy.ToolPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: { status: "pending", input: {}, raw: "{}" },
  }
}

function stepFinish(messageID: string, id: string, reasonValue = "stop"): SessionLegacy.StepFinishPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "step-finish",
    reason: reasonValue,
    snapshot: "after",
    cost: 0.12,
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  }
}

function stepStart(messageID: string, id: string): SessionLegacy.StepStartPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "step-start",
    snapshot: "before",
  }
}

function patch(messageID: string, id: string): SessionLegacy.PatchPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "patch",
    hash: "abc123",
    files: ["README.md"],
  }
}

function retry(messageID: string, id: string): SessionLegacy.RetryPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "retry",
    attempt: 1,
    error: {
      name: "APIError",
      data: { message: "retry", statusCode: 429, isRetryable: true },
    } as SessionLegacy.RetryPart["error"],
    time: { created: 1 },
  }
}

function compaction(messageID: string, id: string): SessionLegacy.CompactionPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "compaction",
    auto: true,
  }
}

function subtask(messageID: string, id: string): SessionLegacy.SubtaskPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "subtask",
    prompt: "check this",
    description: "review",
    agent: "reviewer",
  }
}

function assertNoLegacyIDs(value: unknown) {
  const encoded = JSON.stringify(value)
  expect(encoded).not.toContain("msg_")
  expect(encoded).not.toContain("prt_")
}

function statCount(stats: SessionMessageBackfill.Stat[], type: string, reason: string) {
  return stats.find((stat) => stat.type === type && stat.reason === reason)?.count ?? 0
}

describe("SessionMessageBackfill", () => {
  test("generates deterministic IDs from sorted message order and same-timestamp legacy IDs", () => {
    const first = user("msg_b", 1, [text("msg_b", "prt_2", "second")])
    const second = user("msg_a", 1, [text("msg_a", "prt_1", "first")])

    const left = SessionMessageBackfill.mapLegacyMessages([first, second], { sessionID })
    const right = SessionMessageBackfill.mapLegacyMessages([second, first], { sessionID })

    expect(left.messages.map((message) => message.type === "user" && message.text)).toEqual(["first", "second"])
    expect(left.messages.map((message) => message.id)).toEqual(right.messages.map((message) => message.id))
    expect(left.messages[0]?.id).toMatch(/^evt_legacy_backfill_m_00000000_[0-9a-f]{24}$/)
    expect(left.messages[1]?.id).toMatch(/^evt_legacy_backfill_m_00000001_[0-9a-f]{24}$/)
  })

  test("does not leak raw legacy IDs in encoded canonical output", () => {
    const result = SessionMessageBackfill.mapLegacyMessages(
      [assistant("msg_secret", 1, [text("msg_secret", "prt_secret", "visible")])],
      { sessionID },
    )

    result.messages.forEach((message) => assertNoLegacyIDs(encodeMessage(message)))
  })

  test("maps user text, files, and agents", () => {
    const result = SessionMessageBackfill.mapLegacyMessages(
      [user("msg_user", 1, [text("msg_user", "prt_b", "line 2"), file("msg_user", "prt_c"), agent("msg_user", "prt_d"), text("msg_user", "prt_a", "line 1")])],
      { sessionID },
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      type: "user",
      text: "line 1\nline 2",
      files: [{ uri: "data:image/png;base64,AAAA", mime: "image/png", name: "image.png" }],
      agents: [{ name: "reviewer" }],
      references: [],
    })
    expect(statCount(result.stats.degraded, "file", "file_source_kind_unsupported")).toBe(1)
  })

  test("maps assistant text and reasoning with deterministic distinct IDs", () => {
    const result = SessionMessageBackfill.mapLegacyMessages(
      [assistant("msg_assistant", 1, [reasoning("msg_assistant", "prt_a", "thinking"), text("msg_assistant", "prt_b", "answer")])],
      { sessionID },
    )
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.content.map((content) => content.type)).toEqual(["reasoning", "text"])
    expect(message.content[0]?.id).toMatch(/^evt_legacy_backfill_c_00000000_00000000_[0-9a-f]{24}$/)
    expect(message.content[1]?.id).toMatch(/^evt_legacy_backfill_c_00000000_00000001_[0-9a-f]{24}$/)
    expect(message.content[0]?.type).toBe("reasoning")
    if (message.content[0]?.type !== "reasoning") return
    expect(message.content[0].reasoningID).toMatch(/^rsn_legacy_backfill_00000000_00000000_[0-9a-f]{24}$/)
    expect(message.content[0].reasoningID).not.toBe(message.content[0].id)
  })

  test("maps rich assistant API errors using the current schema category", () => {
    const entry = assistant("msg_error", 1, [])
    if (entry.info.role !== "assistant") return
    entry.info.error = {
      name: "APIError",
      data: {
        message: "provider returned 429",
        statusCode: 429,
        isRetryable: true,
        responseHeaders: { "retry-after": "1" },
        responseBody: "rate limited",
        metadata: { provider: "test" },
      },
    }

    const result = SessionMessageBackfill.mapLegacyMessages([entry], { sessionID })

    expect(result.messages[0]).toMatchObject({
      type: "assistant",
      error: { type: "api", message: "provider returned 429", statusCode: 429, isRetryable: true },
    })
    expect(statCount(result.stats.mapped, "assistant_error", "api")).toBe(1)
  })

  test("records skipped and degraded stats for excluded or conflicting subset parts", () => {
    const entry = assistant("msg_unsupported", 1, [
      tool("msg_unsupported", "prt_a"),
      patch("msg_unsupported", "prt_b"),
      retry("msg_unsupported", "prt_c"),
      compaction("msg_unsupported", "prt_d"),
      subtask("msg_unsupported", "prt_e"),
      stepFinish("msg_unsupported", "prt_f", "length"),
    ])
    if (entry.info.role !== "assistant") return
    entry.info.finish = "stop"

    const result = SessionMessageBackfill.mapLegacyMessages([entry], { sessionID })

    expect(statCount(result.stats.skipped, "tool", "tool_mapping_excluded")).toBe(1)
    expect(statCount(result.stats.skipped, "patch", "patch_schema_missing")).toBe(1)
    expect(statCount(result.stats.skipped, "retry", "retry_mapping_excluded")).toBe(1)
    expect(statCount(result.stats.skipped, "compaction", "compaction_mapping_excluded")).toBe(1)
    expect(statCount(result.stats.skipped, "subtask", "subtask_schema_missing")).toBe(1)
    expect(statCount(result.stats.degraded, "step-finish", "assistant_finish_conflict")).toBe(1)
    expect(statCount(result.stats.degraded, "assistant", "assistant_mode_schema_missing")).toBe(1)
  })

  test("maps step-start snapshot to assistant snapshot start", () => {
    const result = SessionMessageBackfill.mapLegacyMessages(
      [assistant("msg_step_start", 1, [stepStart("msg_step_start", "prt_a"), text("msg_step_start", "prt_b", "answer")])],
      { sessionID },
    )
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.snapshot?.start).toBe("before")
  })

  test("records degraded stats for ignored and synthetic text", () => {
    const ignored = text("msg_degraded_text", "prt_a", "ignored")
    ignored.ignored = true
    const synthetic = text("msg_degraded_text", "prt_b", "synthetic")
    synthetic.synthetic = true

    const result = SessionMessageBackfill.mapLegacyMessages([user("msg_degraded_text", 1, [ignored, synthetic])], { sessionID })

    expect(result.messages[0]).toMatchObject({ type: "user", text: "" })
    expect(statCount(result.stats.degraded, "text", "ignored_text_omitted")).toBe(1)
    expect(statCount(result.stats.degraded, "text", "synthetic_embedded_unsupported")).toBe(1)
  })

  test("fills missing assistant completion fields from step-finish without conflict stats", () => {
    const entry = assistant("msg_step_finish_fill", 1, [stepFinish("msg_step_finish_fill", "prt_a", "stop")])
    if (entry.info.role !== "assistant") return
    delete (entry.info as { cost?: number }).cost

    const result = SessionMessageBackfill.mapLegacyMessages([entry], { sessionID })
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.finish).toBe("stop")
    expect(message.cost).toBe(0.12)
    expect(statCount(result.stats.degraded, "step-finish", "assistant_finish_conflict")).toBe(0)
    expect(statCount(result.stats.degraded, "step-finish", "assistant_cost_conflict")).toBe(0)
  })

  test("uses the last sorted step-finish for assistant completion fallback", () => {
    const firstFinish = stepFinish("msg_multi_step", "prt_a", "first")
    firstFinish.snapshot = "first-after"
    firstFinish.cost = 0.1
    firstFinish.tokens.input = 99
    const finalFinish = stepFinish("msg_multi_step", "prt_c", "length")
    finalFinish.snapshot = "final-after"
    finalFinish.cost = 0.34
    const entry = assistant("msg_multi_step", 1, [finalFinish, text("msg_multi_step", "prt_b", "answer"), firstFinish])
    if (entry.info.role !== "assistant") return
    delete (entry.info as { cost?: number }).cost

    const result = SessionMessageBackfill.mapLegacyMessages([entry], { sessionID })
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.finish).toBe("length")
    expect(message.cost).toBe(0.34)
    expect(message.snapshot?.end).toBe("final-after")
    expect(statCount(result.stats.degraded, "step-finish", "assistant_tokens_conflict")).toBe(0)
  })

  test("does not record token conflicts for unrepresentable total-only differences", () => {
    const finish = stepFinish("msg_token_total", "prt_a")
    finish.tokens.total = 99
    const entry = assistant("msg_token_total", 1, [finish])
    if (entry.info.role !== "assistant") return
    entry.info.tokens.total = 42

    const result = SessionMessageBackfill.mapLegacyMessages([entry], { sessionID })

    expect(statCount(result.stats.degraded, "step-finish", "assistant_tokens_conflict")).toBe(0)
  })

  test("roundtrips mapped messages through encode and decode", () => {
    const result = SessionMessageBackfill.mapLegacyMessages(
      [
        user("msg_user_roundtrip", 1, [text("msg_user_roundtrip", "prt_a", "hello")]),
        assistant("msg_assistant_roundtrip", 2, [text("msg_assistant_roundtrip", "prt_b", "world")]),
      ],
      { sessionID },
    )

    expect(result.messages.map((message) => decodeMessage(encodeMessage(message)))).toEqual(result.messages)
  })

  test("mapper source remains pure and independent from DB/backfill hooks", async () => {
    const source = await Bun.file(new URL("../../src/session/message-backfill.ts", import.meta.url)).text()

    expect(source).not.toContain("SessionMessageTable")
    expect(source).not.toContain("data_migration")
    expect(source).not.toContain("from \"./sql\"")
    expect(source).not.toContain("from \"../database")
  })
})
