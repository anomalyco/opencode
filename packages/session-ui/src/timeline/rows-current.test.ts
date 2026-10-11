import { Skill } from "@opencode/schema/skill"
import { Shell } from "@opencode/schema/shell"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { describe, expect, test } from "bun:test"
import { Predicate } from "effect"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { timelinePresets } from "./detail"
import { createTimelineProjection, Timeline, TimelineRow } from "./projection"

describe("current session timeline rows", () => {
  test("derives turns and tagged rows from chronological current messages", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_1", { disableChecks: true }),
        type: "user",
        text: "first",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_2", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
      {
        id: SessionMessage.ID.make("msg_3", { disableChecks: true }),
        type: "user",
        text: "second",
        time: { created: 4 },
      },
      {
        id: SessionMessage.ID.make("msg_4", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "reasoning", text: "working" }],
        time: { created: 5 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect<unknown>(result.activeMessageID).toBe("msg_3")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:part:part:msg_2:msg_2:text:0",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "thinking:msg_3",
    ])
  })

  test("renders a current shell message as a standalone turn", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_shell", { disableChecks: true }),
        type: "shell",
        shellID: Shell.ID.make("shell_1", { disableChecks: true }),
        command: "pwd",
        status: "exited",
        exit: 0,
        output: { output: "/repo", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
      {
        id: SessionMessage.ID.make("msg_shell_completion", { disableChecks: true }),
        type: "synthetic",
        text: "User shell pwd completed: /repo",
        metadata: { source: "shell", shellID: "shell_1", state: "completed" },
        time: { created: 3 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect<unknown>(result.activeMessageID).toBe("msg_shell")
    expect(result.rows.map(TimelineRow.key)).toEqual(["shell:msg_shell"])
  })

  test("keeps assistant content when no user root is available", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_notice", { disableChecks: true }),
        type: "synthetic",
        text: "done",
        description: "Background work completed",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "result" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect<unknown>(result.activeMessageID).toBe("msg_assistant")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "notice:msg_notice",
      "assistant-part:part:part:msg_assistant:msg_assistant:text:0",
    ])
  })

  test("keeps CLI notice messages between the assistant steps they surround", () => {
    const source: SessionMessageInfo[] = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "run",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_agent", { disableChecks: true }),
        type: "agent-switched",
        agent: Agent.ID.make("explore", { disableChecks: true }),
        time: { created: 2 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant_1", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("explore", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "started" }],
        time: { created: 3, completed: 4 },
      },
      {
        id: SessionMessage.ID.make("msg_background", { disableChecks: true }),
        type: "synthetic",
        text: "result",
        description: "Search code",
        metadata: { source: "subagent", agent: "explore", state: "completed" },
        time: { created: 5 },
      },
      {
        id: SessionMessage.ID.make("msg_model", { disableChecks: true }),
        type: "model-switched",
        model: {
          id: Model.ID.make("next", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        time: { created: 6 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant_2", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("explore", { disableChecks: true }),
        model: {
          id: Model.ID.make("next", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "finished" }],
        time: { created: 7, completed: 8 },
      },
      {
        id: SessionMessage.ID.make("msg_restart", { disableChecks: true }),
        type: "synthetic",
        text: "continue",
        description: "Continuing after restart",
        metadata: { notice: "restart" },
        time: { created: 9 },
      },
      {
        id: SessionMessage.ID.make("msg_skill", { disableChecks: true }),
        type: "skill",
        skill: Skill.ID.make("review", { disableChecks: true }),
        name: "Review",
        text: "instructions",
        time: { created: 10 },
      },
      {
        id: SessionMessage.ID.make("msg_compaction", { disableChecks: true }),
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 11 },
      },
    ]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "notice:msg_agent",
      "assistant-part:part:part:msg_assistant_1:msg_assistant_1:text:0",
      "notice:msg_background",
      "notice:msg_model",
      "assistant-part:part:part:msg_assistant_2:msg_assistant_2:text:0",
      "notice:msg_restart",
      "notice:msg_skill",
      "notice:msg_compaction",
    ])
  })

  test("does not infer thinking from an optimistic busy turn", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_z", { disableChecks: true }),
        type: "user",
        text: "existing",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_a", { disableChecks: true }),
        type: "user",
        text: "pending",
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect<unknown>(result.activeMessageID).toBe("msg_a")
    expect(result.rows.map(TimelineRow.key)).toEqual(["user-message:msg_z", "turn-gap:msg_a", "user-message:msg_a"])
  })

  test("does not infer thinking above a queued user message", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_active", { disableChecks: true }),
        type: "user",
        text: "active",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_queued", { disableChecks: true }),
        type: "user",
        text: "queued",
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(
      source,
      true,
      { type: "busy" },
      new Set([SessionMessage.ID.make("msg_queued", { disableChecks: true })]),
    )

    expect<unknown>(result.activeMessageID).toBe("msg_active")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_active",
      "turn-gap:msg_queued",
      "user-message:msg_queued",
    ])
  })

  test("suppresses thinking while a subagent is delegating or running", () => {
    const statuses = ["streaming", "running"] as const
    statuses.forEach((status) => {
      const source = [
        {
          id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
          type: "user",
          text: "delegate",
          time: { created: 1 },
        },
        {
          id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
          type: "assistant",
          agent: Agent.ID.make("build", { disableChecks: true }),
          model: {
            id: Model.ID.make("model", { disableChecks: true }),
            providerID: Provider.ID.make("provider", { disableChecks: true }),
          },
          content: [
            {
              type: "tool",
              id: "tool_subagent",
              name: "subagent",
              state:
                status === "streaming"
                  ? { status, input: "" }
                  : { status, input: { description: "Inspect code" }, metadata: {} },
              time: { created: 2 },
            },
          ],
          time: { created: 2 },
        },
      ] satisfies SessionMessageInfo[]

      expect(Timeline.constructSessionMessageRows(source, true, { type: "busy" }).rows.map((row) => row._tag)).toEqual([
        "UserMessage",
        "AssistantPart",
      ])
    })
  })

  test("renders retry state from the current assistant message", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "retry",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [],
        retry: { attempt: 2, at: 10, error: { type: "ProviderError", message: "rate limited" } },
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "Retry"])
  })

  test.each(["hidden", "compact", "full"] as const)("only shows active reasoning in %s mode", (reasoningMode) => {
    const active = { type: "reasoning", text: "## Current thought", time: { created: 2 } } as const

    const cases: { content: SessionMessageAssistant["content"]; thinking: boolean }[] = [
      { content: [], thinking: false },
      { content: [active], thinking: true },
      { content: [{ ...active, text: "" }], thinking: true },
      { content: [{ ...active, time: { created: 2, completed: 3 } }], thinking: false },
      { content: [active, { type: "text", text: "Answer" }], thinking: false },
      ...(["streaming", "running", "completed", "error"] as const).flatMap((status) =>
        ["shell", "read", "subagent", "question"].map((name) => ({
          content: [active, storyTool("tool", name, status, {})],
          thinking: false,
        })),
      ),
    ]

    cases.forEach((profile) => {
      const document = storyDocument(profile.content, true)

      const result = createTimelineProjection({
        sessionMessages: document.messages,
        status: document.status,
        reasoningMode,
      })

      expect(result.rows.some((row) => Predicate.isTagged(row, "Thinking"))).toBe(
        reasoningMode !== "hidden" && profile.thinking,
      )
    })
  })

  test("omits a grouped reasoning-only row while busy until other content or completion", () => {
    const thought = { type: "reasoning", text: "Thinking", time: { created: 1, completed: 2 } } as const

    const rows = (content: SessionMessageAssistant["content"], busy: boolean) =>
      createTimelineProjection({
        sessionMessages: storyDocument(content, busy).messages,
        status: { type: busy ? "busy" : "idle" },
        reasoningMode: "compact",
        timelineDetail: timelinePresets[2].value,
      }).rows

    expect(rows([{ ...thought, time: { created: 1 } }], true).map((row) => row._tag)).toEqual(["UserMessage"])
    expect(rows([thought], true).map((row) => row._tag)).toEqual(["UserMessage"])
    expect(rows([thought, { type: "text", text: "" }], true).map((row) => row._tag)).toEqual(["UserMessage"])
    expect(rows([thought, { type: "text", text: "Answer" }], true).map((row) => row._tag)).toEqual([
      "UserMessage",
      "AssistantPart",
      "AssistantPart",
    ])
    expect(
      rows([thought, storyTool("read", "read", "running", { filePath: "package.json" })], true).map((row) => row._tag),
    ).toEqual(["UserMessage", "AssistantPart"])
    expect(rows([thought], false).map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart"])

    const failed = storyDocument([thought], true)

    const messages = failed.messages.map((message) =>
      message.type === "assistant" ? { ...message, error: { type: "provider.error", message: "Failed" } } : message,
    )

    expect(
      createTimelineProjection({
        sessionMessages: messages,
        status: failed.status,
        reasoningMode: "compact",
        timelineDetail: timelinePresets[2].value,
      }).rows.map((row) => row._tag),
    ).toEqual(["UserMessage", "AssistantPart", "Error"])

    expect(
      createTimelineProjection({
        sessionMessages: failed.messages.map((message) =>
          message.type === "assistant" ? { ...message, error: { type: "Interrupted", message: "Stopped" } } : message,
        ),
        status: failed.status,
        reasoningMode: "compact",
        timelineDetail: { ...timelinePresets[2].value, notices: { placement: "hidden" } },
      }).rows.map((row) => row._tag),
    ).toEqual(["UserMessage", "AssistantPart"])
  })

  test("stops thinking on idle, message completion, errors and retries", () => {
    const document = storyDocument([{ type: "reasoning", text: "Current thought" }], true)
    expect(
      Timeline.constructSessionMessageRows(document.messages, true, { type: "idle" }).rows.map((row) => row._tag),
    ).toEqual(["UserMessage", "AssistantPart"])

    const endings = [
      { time: { created: 1, completed: 2 } },
      { error: { type: "Interrupted", message: "Stopped" } },
      { retry: { attempt: 1, at: 10, error: { type: "ProviderError", message: "Retry" } } },
    ]

    endings.forEach((ending) => {
      const messages = document.messages.map((message) =>
        message.type === "assistant" ? { ...message, ...ending } : message,
      )

      expect(
        Timeline.constructSessionMessageRows(messages, true, { type: "busy" }).rows.some((row) =>
          Predicate.isTagged(row, "Thinking"),
        ),
      ).toBe(false)
    })
  })

  test("uses the latest reasoning part and groups earlier thoughts with tools", () => {
    const document = storyDocument(
      [
        { type: "reasoning", text: "Old thought", time: { created: 1, completed: 2 } },
        storyTool("read", "read", "completed", {}),
        { type: "reasoning", text: "New thought", time: { created: 3 } },
      ],
      true,
    )

    const result = Timeline.constructSessionMessageRows(document.messages, true, { type: "busy" })
    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart", "Thinking"])
    expect(result.rows[1]).toMatchObject({
      group: { type: "context", refs: [{ partID: "msg_tool_projection_assistant:reasoning:0" }, { partID: "read" }] },
    })
    expect(result.rows[2]).toMatchObject({ ref: { partID: "msg_tool_projection_assistant:reasoning:1" } })
  })

  test("keeps actual thinking with the active prompt above an undelivered prompt", () => {
    const document = storyDocument([{ type: "reasoning", text: "Active thought" }], true)

    const result = Timeline.constructSessionMessageRows(
      [
        ...document.messages,
        {
          type: "user",
          id: SessionMessage.ID.make("queued", { disableChecks: true }),
          text: "Next task",
          time: { created: 10 },
        },
      ],
      true,
      document.status,
      new Set(["queued"]),
    )

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "Thinking", "TurnGap", "UserMessage"])
    expect(result.rows[1].userMessageID).toBe(document.messages[0].id)
  })

  test("places a queued compaction after the active turn and before undelivered prompts", () => {
    const document = storyDocument([{ type: "text", text: "Working" }], true)

    const result = Timeline.constructSessionMessageRows(
      [
        ...document.messages,
        {
          type: "user",
          id: SessionMessage.ID.make("queued", { disableChecks: true }),
          text: "Next task",
          time: { created: 10 },
        },
      ],
      true,
      document.status,
      new Set([SessionMessage.ID.make("queued", { disableChecks: true })]),
      false,
      false,
      undefined,
      undefined,
      [SessionMessage.ID.make("inb_compact", { disableChecks: true })],
    )

    expect(result.rows.map((row) => row._tag)).toEqual([
      "UserMessage",
      "AssistantPart",
      "CompactionQueued",
      "TurnGap",
      "UserMessage",
    ])
    expect(result.rows[2].userMessageID).toBe(document.messages[0].id)
  })

  test("places a queued compaction ahead of a pending notice, which the server delivers after it", () => {
    const document = storyDocument([{ type: "text", text: "Working" }], true)

    const notice = {
      id: SessionMessage.ID.make("notice", { disableChecks: true }),
      type: "synthetic",
      text: "done",
      description: "Background work completed",
      time: { created: 10 },
    } satisfies SessionMessageInfo

    const result = Timeline.constructSessionMessageRows(
      [...document.messages, notice],
      true,
      document.status,
      new Set([notice.id]),
      false,
      false,
      undefined,
      undefined,
      [SessionMessage.ID.make("inb_compact", { disableChecks: true })],
    )

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart", "CompactionQueued", "Notice"])
  })

  test("keeps live thinking above a notice that arrives while it streams", () => {
    const document = storyDocument([{ type: "reasoning", text: "Active thought" }], true)

    const notice = {
      id: SessionMessage.ID.make("notice", { disableChecks: true }),
      type: "synthetic",
      text: "done",
      description: "Background work completed",
      time: { created: 10 },
    } satisfies SessionMessageInfo

    const result = Timeline.constructSessionMessageRows(
      [...document.messages, notice],
      true,
      document.status,
      undefined,
      false,
      false,
      undefined,
      timelinePresets[0].value,
    )

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "Thinking", "Notice"])
  })

  test.each(["shell", "execute", "subagent"])("does not hide active %s behind a preceding thought", (name) => {
    const document = storyDocument(
      [
        { type: "reasoning", text: "Finished thought", time: { created: 1, completed: 2 } },
        storyTool("active", name, "running", {}),
      ],
      true,
    )

    const result = Timeline.constructSessionMessageRows(document.messages, true, document.status)
    expect(result.rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group.type] : []))).toEqual([
      "part",
      "part",
    ])
  })

  test("keeps divider notices outside grouped context rows", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "move",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [storyTool("tool_read", "read", "completed", {})],
        time: { created: 2, completed: 3 },
      },
      {
        id: SessionMessage.ID.make("msg_moved", { disableChecks: true }),
        type: "location-switched",
        location: { directory: "/tmp/next" },
        time: { created: 4 },
      },
      {
        id: SessionMessage.ID.make("msg_skill", { disableChecks: true }),
        type: "skill",
        skill: Skill.ID.make("review", { disableChecks: true }),
        name: "Review",
        text: "instructions",
        time: { created: 5 },
      },
    ] satisfies SessionMessageInfo[]

    const rows = Timeline.constructSessionMessageRows(
      source,
      false,
      { type: "idle" },
      undefined,
      false,
      false,
      undefined,
      timelinePresets.find((preset) => preset.id === "compact")!.value,
    ).rows

    expect(rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-part:context:context:msg_assistant:tool_read",
      "notice:msg_moved",
      "assistant-part:context:message:msg_skill",
    ])
  })

  test("keeps assistant errors and retries before later notices", () => {
    const result = Timeline.constructSessionMessageRows(
      [
        {
          id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
          type: "user",
          text: "continue",
          time: { created: 1 },
        },
        {
          id: SessionMessage.ID.make("msg_blocked", { disableChecks: true }),
          type: "assistant",
          agent: Agent.ID.make("build", { disableChecks: true }),
          model: {
            id: Model.ID.make("model", { disableChecks: true }),
            providerID: Provider.ID.make("provider", { disableChecks: true }),
          },
          content: [{ type: "text", text: "partial" }],
          error: { type: "provider.content-filter", message: "Provider blocked the response" },
          time: { created: 2, completed: 3 },
        },
        {
          id: SessionMessage.ID.make("msg_model", { disableChecks: true }),
          type: "model-switched",
          model: {
            id: Model.ID.make("next", { disableChecks: true }),
            providerID: Provider.ID.make("provider", { disableChecks: true }),
          },
          time: { created: 4 },
        },
      ],
      true,
      { type: "idle" },
    )

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart", "Error", "Notice"])

    const retry = Timeline.constructSessionMessageRows(
      [
        {
          id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
          type: "user",
          text: "retry",
          time: { created: 1 },
        },
        {
          id: SessionMessage.ID.make("msg_retry", { disableChecks: true }),
          type: "assistant",
          agent: Agent.ID.make("build", { disableChecks: true }),
          model: {
            id: Model.ID.make("model", { disableChecks: true }),
            providerID: Provider.ID.make("provider", { disableChecks: true }),
          },
          content: [],
          error: { type: "ProviderError", message: "rate limited" },
          retry: { attempt: 2, at: 10, error: { type: "ProviderError", message: "rate limited" } },
          time: { created: 2 },
        },
        {
          id: SessionMessage.ID.make("msg_model", { disableChecks: true }),
          type: "model-switched",
          model: {
            id: Model.ID.make("next", { disableChecks: true }),
            providerID: Provider.ID.make("provider", { disableChecks: true }),
          },
          time: { created: 3 },
        },
      ],
      true,
      { type: "retry", attempt: 2, next: 10, message: "rate limited" },
    )

    expect(retry.rows.map((row) => row._tag)).toEqual(["UserMessage", "Retry", "Notice"])
  })

  test("suppresses an earlier error when the turn recovers across a notice", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "recover",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_failed", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [],
        error: { type: "ProviderError", message: "temporary failure" },
        time: { created: 2, completed: 3 },
      },
      {
        id: SessionMessage.ID.make("msg_model", { disableChecks: true }),
        type: "model-switched",
        model: {
          id: Model.ID.make("next", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        time: { created: 4 },
      },
      {
        id: SessionMessage.ID.make("msg_recovery", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("next", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "recovered" }],
        time: { created: 5, completed: 6 },
      },
    ] satisfies SessionMessageInfo[]

    expect(Timeline.constructSessionMessageRows(source, true, { type: "idle" }).rows.map((row) => row._tag)).toEqual([
      "UserMessage",
      "Notice",
      "AssistantPart",
    ])
  })

  test("does not render the retry error twice", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "retry",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [],
        error: { type: "ProviderError", message: "The provider response ended unexpectedly." },
        retry: {
          attempt: 2,
          at: 10,
          error: { type: "ProviderError", message: "The provider response ended unexpectedly." },
        },
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, {
      type: "retry",
      attempt: 2,
      next: 10,
      message: "The provider response ended unexpectedly.",
    })

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "Retry"])
  })

  test("removes a failed assistant error when the turn continues streaming", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "recover",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_failed", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [],
        error: { type: "ProviderError", message: "temporary failure" },
        time: { created: 2, completed: 3 },
      },
      {
        id: SessionMessage.ID.make("msg_recovery", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "streaming again" }],
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart"])
  })

  test("keeps content IDs and groups adjacent context tools", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "inspect",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [
          { type: "text", text: " " },
          { type: "reasoning", text: "hidden" },
          {
            type: "tool",
            id: "tool_read",
            name: "read",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 2 },
          },
          {
            type: "tool",
            id: "tool_grep",
            name: "grep",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 3 },
          },
          {
            type: "tool",
            id: "tool_todo",
            name: "todowrite",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 4 },
          },
          {
            type: "tool",
            id: "tool_question",
            name: "question",
            state: { status: "streaming", input: "" },
            time: { created: 5 },
          },
          { type: "text", text: "visible" },
        ],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, false, { type: "idle" })
    const groups = result.rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group] : []))

    expect<unknown>(groups).toEqual([
      {
        type: "context",
        key: "context:msg_assistant:tool_read",
        refs: [
          { messageID: "msg_assistant", partID: "tool_read" },
          { messageID: "msg_assistant", partID: "tool_grep" },
        ],
      },
      {
        type: "part",
        key: "part:msg_assistant:msg_assistant:text:1",
        ref: {
          messageID: "msg_assistant",
          partID: "msg_assistant:text:1",
        },
      },
    ])
  })

  test("keeps reads that load files outside context groups", () => {
    const read = {
      type: "tool",
      id: "tool_read",
      name: "read",
      state: {
        status: "completed",
        input: { path: "packages/cli/AGENTS.md" },
        content: [{ type: "text", text: "instructions" }],
        metadata: { loaded: ["packages/cli/AGENTS.md"] },
      },
      time: { created: 2, ran: 3, completed: 4 },
    } satisfies SessionMessageAssistantTool

    const grep = {
      type: "tool",
      id: "tool_grep",
      name: "grep",
      state: { status: "running", input: {}, metadata: {} },
      time: { created: 5 },
    } satisfies SessionMessageAssistantTool

    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "inspect",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [read, grep],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const groups = Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.flatMap((row) =>
      Predicate.isTagged(row, "AssistantPart") ? [row.group] : [],
    )

    expect<unknown>(groups).toEqual([
      {
        type: "part",
        key: "part:msg_assistant:tool_read",
        ref: { messageID: "msg_assistant", partID: "tool_read" },
      },
      {
        type: "context",
        key: "context:msg_assistant:tool_grep",
        refs: [{ messageID: "msg_assistant", partID: "tool_grep" }],
      },
    ])
  })

  test("keeps context row keys unique when tool IDs repeat across assistant messages", () => {
    const tool = (name: string) => ({
      type: "tool" as const,
      id: "tool_0",
      name,
      state: { status: "running" as const, input: {}, metadata: {} },
      time: { created: 2 },
    })

    const assistant = (id: string, name: string) => ({
      id: SessionMessage.ID.make(id, { disableChecks: true }),
      type: "assistant" as const,
      agent: Agent.ID.make("build"),
      model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
      content: [tool(name)],
      time: { created: 2 },
    })

    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "inspect",
        time: { created: 1 },
      },
      assistant("msg_assistant_1", "read"),
      assistant("msg_assistant_2", "execute"),
      assistant("msg_assistant_3", "grep"),
    ] satisfies SessionMessageInfo[]

    const keys = Timeline.constructSessionMessageRows(source, false, { type: "idle" }, undefined, true).rows.map(
      TimelineRow.key,
    )

    expect(keys).toEqual([
      "user-message:msg_user",
      "assistant-part:context:context:msg_assistant_1:tool_0",
      "assistant-part:part:part:msg_assistant_2:tool_0",
      "assistant-part:context:context:msg_assistant_3:tool_0",
    ])
  })

  test("groups adjacent successful patches and leaves failed patches separate", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "edit",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [
          {
            type: "tool",
            id: "tool_patch_1",
            name: "patch",
            state: {
              status: "completed",
              input: {},
              content: [{ type: "text", text: "done" }],
              metadata: { files: [] },
            },
            time: { created: 2, completed: 3 },
          },
          {
            type: "tool",
            id: "tool_patch_2",
            name: "patch",
            state: { status: "running", input: {}, metadata: { files: [] } },
            time: { created: 4 },
          },
          {
            type: "tool",
            id: "tool_patch_failed",
            name: "patch",
            state: {
              status: "error",
              input: {},
              error: { type: "ToolError", message: "failed" },
              metadata: { files: [] },
            },
            time: { created: 5, completed: 6 },
          },
          {
            type: "tool",
            id: "tool_patch_3",
            name: "patch",
            state: {
              status: "completed",
              input: {},
              content: [{ type: "text", text: "done" }],
              metadata: { files: [] },
            },
            time: { created: 7, completed: 8 },
          },
          {
            type: "tool",
            id: "tool_edit_1",
            name: "edit",
            state: { status: "running", input: {}, metadata: { files: [] } },
            time: { created: 9 },
          },
          {
            type: "tool",
            id: "tool_edit_2",
            name: "edit",
            state: { status: "running", input: {}, metadata: { files: [] } },
            time: { created: 10 },
          },
          {
            type: "tool",
            id: "tool_write_1",
            name: "write",
            state: { status: "running", input: {}, metadata: { files: [] } },
            time: { created: 11 },
          },
        ],
        time: { created: 2, completed: 8 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, false, { type: "idle" }, undefined, false, true)
    const groups = result.rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group] : []))

    expect<unknown>(groups).toEqual([
      {
        type: "file",
        key: "part:msg_assistant:tool_patch_1",
        refs: [
          { messageID: "msg_assistant", partID: "tool_patch_1" },
          { messageID: "msg_assistant", partID: "tool_patch_2" },
        ],
      },
      {
        type: "part",
        key: "part:msg_assistant:tool_patch_failed",
        ref: {
          messageID: "msg_assistant",
          partID: "tool_patch_failed",
        },
      },
      {
        type: "file",
        key: "part:msg_assistant:tool_patch_3",
        refs: [
          { messageID: "msg_assistant", partID: "tool_patch_3" },
          { messageID: "msg_assistant", partID: "tool_edit_1" },
          { messageID: "msg_assistant", partID: "tool_edit_2" },
          { messageID: "msg_assistant", partID: "tool_write_1" },
        ],
      },
    ])
  })

  test("groups every consecutive collapsed tool in chronological order", () => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "work",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [
          ...["shell", "subagent", "patch", "shell", "edit", "write", "grep"].map(
            (name, index): SessionMessageAssistantTool => ({
              type: "tool" as const,
              id: `tool_${index}`,
              name,
              state: {
                status: "completed" as const,
                input: {},
                content: [{ type: "text" as const, text: "done" }],
                metadata: {},
              },
              time: { created: index + 2, completed: index + 3 },
            }),
          ),
          { type: "text" as const, text: "finished" },
          {
            type: "tool" as const,
            id: "tool_after_text",
            name: "shell",
            state: {
              status: "completed" as const,
              input: {},
              content: [{ type: "text" as const, text: "done" }],
              metadata: {},
            },
            time: { created: 10, completed: 11 },
          },
        ],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const groups = Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.flatMap((row) =>
      Predicate.isTagged(row, "AssistantPart") ? [row.group] : [],
    )

    expect(groups.map((group) => group.type)).toEqual(["context", "part", "context"])
    expect(groups[0]?.type === "context" ? groups[0].refs.map((ref) => ref.partID) : []).toEqual([
      "tool_0",
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
      "tool_5",
      "tool_6",
    ])
    expect(groups[2]?.type === "context" ? groups[2].refs.map((ref) => ref.partID) : []).toEqual(["tool_after_text"])
  })

  test.each([
    { shell: false, edit: false, types: ["context"] },
    { shell: true, edit: false, types: ["part", "context"] },
    { shell: false, edit: true, types: ["context", "file", "context"] },
    { shell: true, edit: true, types: ["part", "file", "context"] },
  ])("keeps tools expanded by settings outside collapsed groups ($shell, $edit)", ({ shell, edit, types }) => {
    const source = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "work",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: ["shell", "edit", "write", "patch", "read"].map(
          (name, index): SessionMessageAssistantTool => ({
            type: "tool" as const,
            id: `tool_${name}`,
            name,
            state: {
              status: "completed" as const,
              input: {},
              content: [{ type: "text" as const, text: "done" }],
              metadata: {},
            },
            time: { created: index + 2, completed: index + 3 },
          }),
        ),
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const rows = Timeline.constructSessionMessageRows(source, false, { type: "idle" }, undefined, shell, edit).rows

    expect(rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group.type] : []))).toEqual([
      ...types,
    ])
  })

  test("merges adjacent separate reads into one read row split by other parts", () => {
    const rows = Timeline.constructSessionMessageRows(
      storyDocument([
        storyTool("read_1", "read", "completed", { path: "src/a.ts" }),
        storyTool("read_2", "read", "running", { path: "src/b.ts", limit: 120 }),
        { type: "reasoning", text: "Keep reading." },
        storyTool("read_3", "read", "completed", { path: "src/c.ts" }),
        storyTool("read_image", "read", "completed", { path: "src/logo.png" }),
        storyTool("read_failed", "read", "error", { path: "src/missing.ts" }),
        storyTool("read_4", "read", "completed", { path: "src/d.ts" }),
        storyTool("read_5", "read", "completed", { path: "src/e.ts" }),
        storyTool("glob", "glob", "completed", { pattern: "*.ts" }),
        storyTool("read_6", "read", "completed", { path: "src/f.ts" }),
      ]).messages,
      true,
      { type: "idle" },
      undefined,
      false,
      false,
      undefined,
      timelinePresets[0].value,
    ).rows

    expect(
      rows.flatMap((row) =>
        !Predicate.isTagged(row, "AssistantPart")
          ? []
          : [
              [
                row.group.type,
                ...(row.group.type === "part" ? [row.group.ref] : row.group.refs).map((ref) => ref.partID),
              ],
            ],
      ),
    ).toEqual([
      ["read", "read_1", "read_2"],
      ["part", "msg_tool_projection_assistant:reasoning:0"],
      ["read", "read_3"],
      ["part", "read_image"],
      ["part", "read_failed"],
      ["read", "read_4", "read_5"],
      ["part", "glob"],
      ["read", "read_6"],
    ])
  })

  test.each(["shell", "execute", "subagent"])("keeps %s in an existing group throughout execution", (name) => {
    const initial = createTimelineProjection({
      sessionMessages: storyDocument([storyTool("earlier", "read", "completed", {})]).messages,
      status: { type: "busy" },
      reasoningMode: "hidden",
    })

    const phases = [
      { status: "streaming" },
      { status: "running" },
      { status: "completed", metadata: { status: "running" } },
      { status: "completed" },
      { status: "error" },
    ] as const

    phases.reduce((previousRows, phase, index) => {
      const result = createTimelineProjection({
        sessionMessages: [
          ...storyDocument([storyTool("earlier", "read", "completed", {})]).messages,
          ...storyDocument([
            storyTool("active", name, phase.status, {}, "metadata" in phase ? { metadata: phase.metadata } : {}),
          ])
            .messages.filter((message) => message.type === "assistant")
            .map((message) => ({ ...message, id: SessionMessage.ID.make("next-step", { disableChecks: true }) })),
        ],
        status: { type: "busy" },
        reasoningMode: "hidden",
        previousRows,
      })

      const groups = result.rows.filter((row) => Predicate.isTagged(row, "AssistantPart"))
      expect(groups).toHaveLength(1)
      expect(groups[0].group).toMatchObject({
        type: "context",
        refs: [
          { messageID: "msg_tool_projection_assistant", partID: "earlier" },
          { messageID: "next-step", partID: "active" },
        ],
      })
      expect(TimelineRow.key(groups[0])).toBe(TimelineRow.key(initial.rows[1]))

      if (index > 0) expect(groups[0]).toBe(previousRows.find((row) => Predicate.isTagged(row, "AssistantPart"))!)

      return result.rows
    }, initial.rows)
  })

  test.each([
    { name: "shell", expanded: true, types: ["context", "part"] },
    { name: "execute", expanded: true, types: ["context", "part"] },
    { name: "subagent", expanded: true, types: ["context"] },
    { name: "shell", separator: "text", types: ["context", "part", "part"] },
    { name: "shell", separator: "reasoning", showReasoning: true, types: ["context"] },
    { name: "shell", separator: "reasoning", showReasoning: false, types: ["context"] },
  ] as const)("respects active tool grouping boundaries: %j", (profile) => {
    const content = [
      storyTool("earlier", "read", "completed", {}),
      ...(profile.separator ? [{ type: profile.separator, text: "Visible boundary" }] : []),
      storyTool("active", profile.name, "running", {}),
    ]

    const rows = Timeline.constructSessionMessageRows(
      storyDocument(content).messages,
      profile.showReasoning ?? false,
      { type: "busy" },
      undefined,
      profile.expanded ?? false,
    ).rows

    expect(rows.flatMap((row) => (Predicate.isTagged(row, "AssistantPart") ? [row.group.type] : []))).toEqual([
      ...profile.types,
    ])
  })

  test("keeps active and background work standalone when no group precedes them", () => {
    const source: SessionMessageInfo[] = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "work",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [
          {
            type: "tool",
            id: "tool_running_shell",
            name: "shell",
            state: { status: "running", input: {}, metadata: {} },
            time: { created: 2 },
          },
          {
            type: "tool",
            id: "tool_background_agent",
            name: "subagent",
            state: {
              status: "completed",
              input: {},
              content: [{ type: "text", text: "running" }],
              metadata: { status: "running" },
            },
            time: { created: 3, completed: 4 },
          },
          {
            type: "tool",
            id: "tool_completed_shell",
            name: "shell",
            state: {
              status: "completed",
              input: {},
              content: [{ type: "text", text: "done" }],
              metadata: {},
            },
            time: { created: 5, completed: 6 },
          },
        ],
        time: { created: 2 },
      },
    ]

    expect(
      Timeline.constructSessionMessageRows(source, false, { type: "busy" }).rows.flatMap((row) =>
        Predicate.isTagged(row, "AssistantPart") ? [row.group.type] : [],
      ),
    ).toEqual(["part", "part", "context"])
  })

  test("keeps failed calls inside a collapsed mixed-tool stack", () => {
    const source: SessionMessageInfo[] = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "search",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [
          {
            type: "tool",
            id: "tool_glob_failed",
            name: "glob",
            state: {
              status: "error",
              input: { pattern: "*.ts" },
              error: { type: "ToolError", message: "Invalid tool input" },
              metadata: {},
            },
            time: { created: 2, completed: 3 },
          },
          {
            type: "tool",
            id: "tool_grep_failed",
            name: "grep",
            state: {
              status: "error",
              input: { pattern: "value" },
              error: { type: "ToolError", message: "Search timed out" },
              metadata: {},
            },
            time: { created: 4, completed: 5 },
          },
          {
            type: "tool",
            id: "tool_shell_failed",
            name: "shell",
            state: {
              status: "error",
              input: { command: "exit 1" },
              error: { type: "ToolError", message: "Command failed" },
              metadata: {},
            },
            time: { created: 6, completed: 7 },
          },
        ],
        time: { created: 2, completed: 8 },
      },
    ]

    const groups = Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.flatMap((row) =>
      Predicate.isTagged(row, "AssistantPart") ? [row.group] : [],
    )

    expect<unknown>(groups).toEqual([
      {
        type: "context",
        key: "context:msg_assistant:tool_glob_failed",
        refs: [
          { messageID: "msg_assistant", partID: "tool_glob_failed" },
          { messageID: "msg_assistant", partID: "tool_grep_failed" },
          { messageID: "msg_assistant", partID: "tool_shell_failed" },
        ],
      },
    ])
    expect(
      Timeline.constructSessionMessageRows(source, false, { type: "idle" }, undefined, true).rows.flatMap((row) =>
        Predicate.isTagged(row, "AssistantPart") ? [row.group.type] : [],
      ),
    ).toEqual(["context", "part"])
  })

  test("places a divider after interrupted output unless the turn compacts", () => {
    const messages = [
      {
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        type: "user",
        text: "continue",
        time: { created: 1 },
      },
      {
        id: SessionMessage.ID.make("msg_interrupted", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "before" }],
        error: { type: "ExecutionInterrupted", message: "stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: SessionMessage.ID.make("msg_continued", { disableChecks: true }),
        type: "assistant",
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
        content: [{ type: "text", text: "after" }],
        time: { created: 4, completed: 5 },
      },
    ] satisfies SessionMessageInfo[]

    expect(Timeline.constructSessionMessageRows(messages, true, { type: "idle" }).rows.map((row) => row._tag)).toEqual([
      "UserMessage",
      "AssistantPart",
      "TurnDivider",
      "AssistantPart",
    ])

    const compacted = [
      messages[0],
      messages[1],
      {
        id: SessionMessage.ID.make("msg_compaction", { disableChecks: true }),
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 4 },
      },
      messages[2],
    ] satisfies SessionMessageInfo[]

    expect(Timeline.constructSessionMessageRows(compacted, true, { type: "idle" }).rows.map((row) => row._tag)).toEqual(
      ["UserMessage", "AssistantPart", "Notice", "AssistantPart"],
    )
  })

  test("surfaces failed idle errors when no assistant step owns the failure", () => {
    const preStep = [
      { id: "msg_user", type: "user", text: "prompt", time: { created: 1 } },
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "provider.no-route", message: "Model unavailable: opencode/gpt-5.2" },
        time: { created: 2 },
      },
      {
        id: "msg_model",
        type: "model-switched",
        model: { id: "next", providerID: "provider" },
        time: { created: 3 },
      },
    ] satisfies SessionMessageInfo[]

    const preStepRows = Timeline.constructSessionMessageRows(preStep, true, { type: "idle" }).rows
    expect(preStepRows.map((row) => row._tag)).toEqual(["UserMessage", "Error", "Notice"])
    expect(preStepRows[1]).toEqual(
      new TimelineRow.Error({ userMessageID: "msg_user", text: "Model unavailable: opencode/gpt-5.2" }),
    )

    const betweenSteps = [
      { id: "msg_user", type: "user", text: "prompt", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [storyTool("tool_read", "read", "completed", {})],
        finish: "tool-calls",
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "unknown", message: "Failed to execute statement" },
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]

    expect(
      Timeline.constructSessionMessageRows(betweenSteps, true, { type: "idle" }).rows.map((row) => row._tag),
    ).toEqual(["UserMessage", "AssistantPart", "Error"])

    const duplicate = [
      { id: "msg_user", type: "user", text: "prompt", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        finish: "error",
        error: { type: "provider.auth", message: "Your organization does not have access to this model." },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "provider.auth", message: "Your organization does not have access to this model." },
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]

    expect(Timeline.constructSessionMessageRows(duplicate, true, { type: "idle" }).rows.map((row) => row._tag)).toEqual(
      ["UserMessage", "Error"],
    )

    const exhausted = [
      { id: "msg_user", type: "user", text: "prompt", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        error: { type: "aborted", message: "Step interrupted" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: {
          type: "aborted",
          message: "Execution was interrupted repeatedly and will not be resumed automatically.",
        },
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]

    expect(Timeline.constructSessionMessageRows(exhausted, true, { type: "idle" }).rows.at(-1)).toEqual(
      new TimelineRow.Error({
        userMessageID: "msg_user",
        text: "Execution was interrupted repeatedly and will not be resumed automatically.",
      }),
    )
  })
})
