import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode-ai/client/promise"
import { Timeline, TimelineRow } from "./projection"

describe("current session timeline rows", () => {
  test("derives turns and tagged rows from chronological current messages", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "answer" }],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_3", type: "user", text: "second", time: { created: 4 } },
      {
        id: "msg_4",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "reasoning", text: "working" }],
        time: { created: 5 },
      },
    ] satisfies SessionMessageInfo[]
    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.activeMessageID).toBe("msg_3")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:part:msg_2:msg_2:text:0",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "assistant-part:part:msg_4:msg_4:reasoning:0",
    ])
  })

  test("renders a current shell message as a standalone turn", () => {
    const source = [
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        command: "pwd",
        status: "exited",
        exit: 0,
        output: { output: "/repo", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
    ] satisfies SessionMessageInfo[]
    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect(result.activeMessageID).toBe("msg_shell")
    expect(result.rows.map(TimelineRow.key)).toEqual(["shell:msg_shell"])
  })

  test("keeps assistant content when no user root is available", () => {
    const source = [
      {
        id: "msg_notice",
        type: "synthetic",
        text: "done",
        description: "Background work completed",
        time: { created: 1 },
      },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "result" }],
        time: { created: 2, completed: 3 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect(result.activeMessageID).toBe("msg_assistant")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "notice:msg_notice",
      "assistant-part:part:msg_assistant:msg_assistant:text:0",
    ])
  })

  test("keeps CLI notice messages between the assistant steps they surround", () => {
    const source = [
      { id: "msg_user", type: "user", text: "run", time: { created: 1 } },
      { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 2 } },
      {
        id: "msg_assistant_1",
        type: "assistant",
        agent: "explore",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "started" }],
        time: { created: 3, completed: 4 },
      },
      {
        id: "msg_background",
        type: "synthetic",
        text: "result",
        description: "Search code",
        metadata: { source: "subagent", agent: "explore", state: "completed" },
        time: { created: 5 },
      },
      {
        id: "msg_model",
        type: "model-switched",
        model: { id: "next", providerID: "provider" },
        time: { created: 6 },
      },
      {
        id: "msg_assistant_2",
        type: "assistant",
        agent: "explore",
        model: { id: "next", providerID: "provider" },
        content: [{ type: "text", text: "finished" }],
        time: { created: 7, completed: 8 },
      },
      {
        id: "msg_restart",
        type: "synthetic",
        text: "continue",
        description: "Continuing after restart",
        time: { created: 9 },
      },
      { id: "msg_skill", type: "skill", skill: "review", name: "Review", text: "instructions", time: { created: 10 } },
      {
        id: "msg_compaction",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 11 },
      },
    ] satisfies SessionMessageInfo[]
    const result = Timeline.constructSessionMessageRows(source, true, { type: "idle" })

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "notice:msg_agent",
      "assistant-part:part:msg_assistant_1:msg_assistant_1:text:0",
      "notice:msg_background",
      "notice:msg_model",
      "assistant-part:part:msg_assistant_2:msg_assistant_2:text:0",
      "notice:msg_restart",
      "notice:msg_skill",
      "notice:msg_compaction",
    ])
  })

  test("renders an optimistic user turn and thinking before the protocol message arrives", () => {
    const source = [
      { id: "msg_z", type: "user", text: "existing", time: { created: 1 } },
      { id: "msg_a", type: "user", text: "pending", time: { created: 2 } },
    ] satisfies SessionMessageInfo[]
    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.activeMessageID).toBe("msg_a")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_z",
      "turn-gap:msg_a",
      "user-message:msg_a",
      "thinking:msg_a",
    ])
  })

  test("suppresses thinking while a subagent is delegating or running", () => {
    const statuses = ["streaming", "running"] as const
    statuses.forEach((status) => {
      const source = [
        { id: "msg_user", type: "user", text: "delegate", time: { created: 1 } },
        {
          id: "msg_assistant",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
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

      expect(Timeline.constructSessionMessageRows(source, false, { type: "busy" }).rows.map((row) => row._tag)).toEqual(
        ["UserMessage", "AssistantPart"],
      )
    })
  })

  test("renders retry state from the current assistant message", () => {
    const source = [
      { id: "msg_user", type: "user", text: "retry", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        retry: { attempt: 2, at: 10, error: { type: "ProviderError", message: "rate limited" } },
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "Retry"])
  })

  test("does not render the retry error twice", () => {
    const source = [
      { id: "msg_user", type: "user", text: "retry", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
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
      { id: "msg_user", type: "user", text: "recover", time: { created: 1 } },
      {
        id: "msg_failed",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        error: { type: "ProviderError", message: "temporary failure" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_recovery",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "streaming again" }],
        time: { created: 4 },
      },
    ] satisfies SessionMessageInfo[]
    const result = Timeline.constructSessionMessageRows(source, true, { type: "busy" })

    expect(result.rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart"])
  })

  test("keeps content IDs and groups adjacent context tools", () => {
    const source = [
      { id: "msg_user", type: "user", text: "inspect", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
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
    const groups = result.rows.flatMap((row) => (row._tag === "AssistantPart" ? [row.group] : []))

    expect(groups).toEqual([
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
        ref: { messageID: "msg_assistant", partID: "msg_assistant:text:1" },
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
      { id: "msg_user", type: "user", text: "inspect", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [read, grep],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const groups = Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.flatMap((row) =>
      row._tag === "AssistantPart" ? [row.group] : [],
    )

    expect(groups).toEqual([
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
      id,
      type: "assistant" as const,
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [tool(name)],
      time: { created: 2 },
    })
    const source = [
      { id: "msg_user", type: "user", text: "inspect", time: { created: 1 } },
      assistant("msg_assistant_1", "read"),
      assistant("msg_assistant_2", "execute"),
      assistant("msg_assistant_3", "grep"),
    ] satisfies SessionMessageInfo[]

    const keys = Timeline.constructSessionMessageRows(source, false, { type: "idle" }).rows.map(TimelineRow.key)

    expect(keys).toEqual([
      "user-message:msg_user",
      "assistant-part:context:msg_assistant_1:tool_0",
      "assistant-part:part:msg_assistant_2:tool_0",
      "assistant-part:context:msg_assistant_3:tool_0",
    ])
  })

  test("groups adjacent successful patches and leaves failed patches separate", () => {
    const source = [
      { id: "msg_user", type: "user", text: "edit", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
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
        ],
        time: { created: 2, completed: 8 },
      },
    ] satisfies SessionMessageInfo[]

    const result = Timeline.constructSessionMessageRows(source, false, { type: "idle" })
    const groups = result.rows.flatMap((row) => (row._tag === "AssistantPart" ? [row.group] : []))

    expect(groups).toEqual([
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
        ref: { messageID: "msg_assistant", partID: "tool_patch_failed" },
      },
      {
        type: "file",
        key: "part:msg_assistant:tool_patch_3",
        refs: [{ messageID: "msg_assistant", partID: "tool_patch_3" }],
      },
      {
        type: "file",
        key: "part:msg_assistant:tool_edit_1",
        refs: [
          { messageID: "msg_assistant", partID: "tool_edit_1" },
          { messageID: "msg_assistant", partID: "tool_edit_2" },
        ],
      },
    ])
  })

  test("places a divider after interrupted output unless the turn compacts", () => {
    const messages = [
      { id: "msg_user", type: "user", text: "continue", time: { created: 1 } },
      {
        id: "msg_interrupted",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "before" }],
        error: { type: "ExecutionInterrupted", message: "stopped" },
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_continued",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
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
        id: "msg_compaction",
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
})
