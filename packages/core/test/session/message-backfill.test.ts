import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
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

function runningTool(messageID: string, id: string): SessionLegacy.ToolPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "tool",
    callID: "call_1",
    tool: "bash",
    metadata: { providerExecuted: true, serverToolID: "srv_1" },
    state: { status: "running", input: { cmd: "pwd" }, title: "Run command", metadata: { note: "legacy" }, time: { start: 11 } },
  }
}

function completedTool(messageID: string, id: string): SessionLegacy.ToolPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: {
      status: "completed",
      input: { cmd: "cat image" },
      output: "done",
      title: "Read file",
      metadata: { structured: { exitCode: 0 } },
      time: { start: 12, end: 13, compacted: 14 },
      attachments: [file(messageID, "prt_attachment")],
    },
  }
}

function errorTool(messageID: string, id: string, metadata?: Record<string, unknown>): SessionLegacy.ToolPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: { status: "error", input: { cmd: "false" }, error: "failed", metadata, time: { start: 15, end: 16 } },
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

function retry(messageID: string, id: string, attempt = 1, created = 1): SessionLegacy.RetryPart {
  return {
    id: SessionLegacy.PartID.make(id),
    sessionID,
    messageID: SessionLegacy.MessageID.make(messageID),
    type: "retry",
    attempt,
    error: {
      name: "APIError",
      data: { message: `retry ${attempt}`, statusCode: 429, isRetryable: true, responseHeaders: { "retry-after": "1" }, responseBody: "rate limited", metadata: { provider: "test" } },
    } as SessionLegacy.RetryPart["error"],
    time: { created },
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

function assistantToolContent(message: SessionMessage.Message) {
  expect(message.type).toBe("assistant")
  if (message.type !== "assistant") throw new Error("expected assistant message")
  const content = message.content.find((item): item is SessionMessage.AssistantTool => item.type === "tool")
  if (!content) throw new Error("expected assistant tool content")
  return content
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

    expect(statCount(result.stats.mapped, "tool", "assistant_tool_pending")).toBe(1)
    expect(statCount(result.stats.skipped, "tool", "tool_mapping_excluded")).toBe(0)
    expect(statCount(result.stats.skipped, "patch", "patch_schema_missing")).toBe(1)
    expect(statCount(result.stats.mapped, "retry", "assistant_retry")).toBe(1)
    expect(statCount(result.stats.skipped, "retry", "retry_mapping_excluded")).toBe(0)
    expect(statCount(result.stats.skipped, "compaction", "compaction_mapping_excluded")).toBe(1)
    expect(statCount(result.stats.skipped, "subtask", "subtask_schema_missing")).toBe(1)
    expect(statCount(result.stats.degraded, "step-finish", "assistant_finish_conflict")).toBe(1)
    expect(statCount(result.stats.degraded, "assistant", "assistant_mode_schema_missing")).toBe(1)
  })

  test("maps assistant retry parts to assistant retries with API error details and created time", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_retry", 1, [retry("msg_retry", "prt_retry", 2, 123)])], { sessionID })
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.retries).toEqual([
      {
        attempt: 2,
        error: {
          message: "retry 2",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "retry-after": "1" },
          responseBody: "rate limited",
          metadata: { provider: "test" },
        },
        time: { created: DateTime.makeUnsafe(123) },
      },
    ])
    expect(message.retries).toBeDefined()
    if (!message.retries?.[0]) return
    expect(DateTime.toEpochMillis(message.retries[0].time.created)).toBe(123)
    expect(statCount(result.stats.mapped, "retry", "assistant_retry")).toBe(1)
    assertNoLegacyIDs(encodeMessage(message))
  })

  test("sorts multiple assistant retries by legacy part ID without changing content IDs", () => {
    const withoutRetry = SessionMessageBackfill.mapLegacyMessages(
      [assistant("msg_retry_order", 1, [text("msg_retry_order", "prt_b", "answer"), tool("msg_retry_order", "prt_d")])],
      { sessionID },
    )
    const withRetry = SessionMessageBackfill.mapLegacyMessages(
      [
        assistant("msg_retry_order", 1, [
          retry("msg_retry_order", "prt_c", 2, 20),
          tool("msg_retry_order", "prt_d"),
          retry("msg_retry_order", "prt_a", 1, 10),
          text("msg_retry_order", "prt_b", "answer"),
        ]),
      ],
      { sessionID },
    )
    const withoutMessage = withoutRetry.messages[0]
    const withMessage = withRetry.messages[0]

    expect(withoutMessage?.type).toBe("assistant")
    expect(withMessage?.type).toBe("assistant")
    if (withoutMessage?.type !== "assistant" || withMessage?.type !== "assistant") return
    expect(withMessage.retries?.map((item) => item.attempt)).toEqual([1, 2])
    expect(withMessage.content.map((content) => content.id)).toEqual(withoutMessage.content.map((content) => content.id))
    assertNoLegacyIDs(encodeMessage(withMessage))
  })

  test("records user retry parts as skipped without mapping them into user messages", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([user("msg_user_retry", 1, [text("msg_user_retry", "prt_a", "hello"), retry("msg_user_retry", "prt_b")])], { sessionID })
    const message = result.messages[0]

    expect(message).toMatchObject({ type: "user", text: "hello" })
    if (!message) return
    expect(JSON.stringify(encodeMessage(message))).not.toContain("retries")
    expect(statCount(result.stats.skipped, "retry", "retry_user_unsupported")).toBe(1)
  })

  test("degrades unsupported retry error categories and skips cross-message retry parts", () => {
    const unsupported = retry("msg_retry_degraded", "prt_a")
    unsupported.error = { name: "MessageAbortedError", data: { message: "aborted" } } as unknown as SessionLegacy.RetryPart["error"]
    const orphan = retry("msg_other", "prt_b")
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_retry_degraded", 1, [orphan, unsupported])], { sessionID })
    const message = result.messages[0]

    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.retries).toMatchObject([{ attempt: 1, error: { message: "aborted", isRetryable: false } }])
    expect(statCount(result.stats.degraded, "retry", "retry_error_category_unsupported")).toBe(1)
    expect(statCount(result.stats.skipped, "retry", "retry_no_active_assistant")).toBe(1)
  })

  test("maps pending assistant tools with deterministic content IDs and raw input", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_tool_pending", 1, [tool("msg_tool_pending", "prt_tool")])], { sessionID })
    const content = assistantToolContent(result.messages[0]!)

    expect(content).toMatchObject({ type: "tool", callID: "call_1", name: "bash", state: { status: "pending", input: "{}" } })
    expect(content.id).toMatch(/^evt_legacy_backfill_c_00000000_00000000_[0-9a-f]{24}$/)
    assertNoLegacyIDs(encodeMessage(result.messages[0]!))
  })

  test("maps running assistant tools with ran timing and provider metadata", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_tool_running", 1, [runningTool("msg_tool_running", "prt_tool")])], { sessionID })
    const content = assistantToolContent(result.messages[0]!)

    expect(content.provider).toEqual({ executed: true, metadata: { serverToolID: "srv_1" } })
    expect(content.state).toMatchObject({ status: "running", input: { cmd: "pwd" }, structured: {}, content: [] })
    expect(DateTime.toEpochMillis(content.time.created)).toBe(1)
    expect(content.time.ran && DateTime.toEpochMillis(content.time.ran)).toBe(11)
    expect(statCount(result.stats.degraded, "tool", "tool_title_schema_missing")).toBe(1)
    expect(statCount(result.stats.degraded, "tool", "tool_state_metadata_schema_missing")).toBe(1)
  })

  test("maps completed tool text and file attachments as tool output content without attachments field", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_tool_completed", 1, [completedTool("msg_tool_completed", "prt_tool")])], { sessionID })
    const content = assistantToolContent(result.messages[0]!)

    expect(content.state.status).toBe("completed")
    if (content.state.status !== "completed") return
    expect(content.state.content).toEqual([
      { type: "text", text: "done" },
      { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "image.png" },
    ])
    expect(content.state.structured).toEqual({ exitCode: 0 })
    expect(DateTime.toEpochMillis(content.time.ran!)).toBe(12)
    expect(DateTime.toEpochMillis(content.time.completed!)).toBe(13)
    expect(DateTime.toEpochMillis(content.time.pruned!)).toBe(14)
    expect(JSON.stringify(encodeMessage(result.messages[0]!))).not.toContain("attachments")
    expect(statCount(result.stats.mapped, "file", "tool_file_content")).toBe(1)
  })

  test("maps error tools to unknown errors and preserves representable text output", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_tool_error", 1, [errorTool("msg_tool_error", "prt_tool", { output: "partial output", structured: { code: 1 } })])], { sessionID })
    const content = assistantToolContent(result.messages[0]!)

    expect(content.state.status).toBe("error")
    if (content.state.status !== "error") return
    expect(content.state.error).toEqual({ type: "unknown", message: "failed" })
    expect(content.state.content).toEqual([{ type: "text", text: "partial output" }])
    expect(content.state.structured).toEqual({ code: 1 })
    expect(DateTime.toEpochMillis(content.time.ran!)).toBe(15)
    expect(DateTime.toEpochMillis(content.time.completed!)).toBe(16)
    expect(statCount(result.stats.mapped, "tool", "tool_error_output_text")).toBe(1)
  })

  test("records degraded stats for error tool output that cannot be represented", () => {
    const result = SessionMessageBackfill.mapLegacyMessages([assistant("msg_tool_error_degraded", 1, [errorTool("msg_tool_error_degraded", "prt_tool", { output: { nested: true } })])], { sessionID })
    const content = assistantToolContent(result.messages[0]!)

    expect(content.state.status).toBe("error")
    if (content.state.status !== "error") return
    expect(content.state.content).toEqual([])
    expect(statCount(result.stats.degraded, "tool", "tool_error_output_not_representable")).toBe(1)
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
        assistant("msg_assistant_roundtrip", 2, [text("msg_assistant_roundtrip", "prt_b", "world"), completedTool("msg_assistant_roundtrip", "prt_c")]),
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
