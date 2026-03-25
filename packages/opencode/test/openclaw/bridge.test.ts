import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import { OpenClawBridge } from "../../src/openclaw/bridge"

describe("OpenClawBridge.internal.historyMessages", () => {
  test("maps anthropic-style tool_use and tool_result into tool parts", () => {
    const items = OpenClawBridge.internal.historyMessages("sess", [
      {
        role: "user",
        content: [{ type: "text", text: "run ls" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking." },
          { type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } },
        ],
        timestamp: 2,
        provider: "openclaw",
        model: "claw",
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file-a\nfile-b" }],
        timestamp: 3,
      },
    ])

    expect(items).toHaveLength(2)
    expect(items[1].parts).toEqual([
      expect.objectContaining({ type: "text", text: "Checking." }),
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        callID: "toolu_1",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "ls" },
          output: "file-a\nfile-b",
        }),
      }),
    ])
  })

  test("maps openai-style tool_calls and function_call_output into tool parts", () => {
    const items = OpenClawBridge.internal.historyMessages("sess", [
      {
        role: "user",
        content: "run pwd",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: "pwd" }),
            },
          },
        ],
        timestamp: 2,
      },
      {
        role: "tool",
        content: [{ type: "function_call_output", call_id: "call_1", output: "/tmp/project" }],
        timestamp: 3,
      },
    ] as any)

    expect(items).toHaveLength(2)
    expect(items[1].parts).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        callID: "call_1",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/project",
        }),
      }),
    ])
  })

  test("maps assistant messages that contain both toolCall and toolResult blocks", () => {
    const items = OpenClawBridge.internal.historyMessages("sess", [
      {
        role: "user",
        content: [{ type: "text", text: "count files" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_real_1",
            name: "exec",
            arguments: { cmd: "find . -type f | wc -l" },
          },
          {
            type: "toolResult",
            toolCallId: "call_real_1",
            result: "42",
          },
        ],
        timestamp: 2,
        provider: "openclaw",
        model: "claw",
      },
    ] as any)

    expect(items).toHaveLength(2)
    expect(items[1].parts).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "exec",
        callID: "call_real_1",
        state: expect.objectContaining({
          status: "completed",
          input: { cmd: "find . -type f | wc -l" },
          output: "42",
        }),
      }),
    ])
  })

  test("maps OpenClaw history entries with role toolResult into completed tool parts", () => {
    const items = OpenClawBridge.internal.historyMessages("sess", [
      {
        role: "user",
        content: [{ type: "text", text: "workspace 下面有什么 .md 文件？" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_read_1",
            name: "read",
            arguments: { path: "/Users/lelouch/.openclaw/workspace/SOUL.md" },
          },
          {
            type: "toolCall",
            id: "call_exec_1",
            name: "exec",
            arguments: { command: "find /Users/lelouch/.openclaw/workspace -type f -name '*.md' | sort" },
          },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_read_1",
        toolName: "read",
        content: [{ type: "text", text: "# SOUL" }],
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "call_exec_1",
        toolName: "exec",
        content: [{ type: "text", text: "/Users/lelouch/.openclaw/workspace/SOUL.md" }],
        timestamp: 4,
      },
    ] as any)

    expect(items).toHaveLength(2)
    expect(items[1].parts).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "read",
        callID: "call_read_1",
        state: expect.objectContaining({
          status: "completed",
          input: { path: "/Users/lelouch/.openclaw/workspace/SOUL.md" },
          output: "# SOUL",
        }),
      }),
      expect.objectContaining({
        type: "tool",
        tool: "exec",
        callID: "call_exec_1",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "find /Users/lelouch/.openclaw/workspace -type f -name '*.md' | sort" },
          output: "/Users/lelouch/.openclaw/workspace/SOUL.md",
        }),
      }),
    ])
  })

  test("keeps assistant replies attached to the original user turn across tool result hops", () => {
    const items = OpenClawBridge.internal.historyMessages("sess", [
      {
        role: "user",
        content: [{ type: "text", text: "show package files" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } }],
        timestamp: 2,
        provider: "openclaw",
        model: "claw",
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "package.json" }],
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I found package.json." }],
        timestamp: 4,
        provider: "openclaw",
        model: "claw",
      },
    ])

    expect(items).toHaveLength(3)
    expect(items[1]?.info.role).toBe("assistant")
    expect(items[2]?.info.role).toBe("assistant")
    expect(items[1]?.info.parentID).toBe(items[0]?.info.id)
    expect(items[2]?.info.parentID).toBe(items[0]?.info.id)
  })

  test("generates lexicographically sortable message ids for long histories", () => {
    const items = OpenClawBridge.internal.historyMessages(
      "sess",
      Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `m${i}` }],
        timestamp: i + 1,
      })) as any,
    )

    expect(items).toHaveLength(12)
    expect(items.map((item) => item.info.id)).toEqual([...items.map((item) => item.info.id)].sort())
    expect(items.map((item) => item.parts[0]?.type)).toEqual([
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
    ])
  })
})

describe("OpenClawBridge live events", () => {
  test("parses tool parts from stream payload content", () => {
    const current = new Map<string, ToolPart>()
    const first = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking files" },
          { type: "tool_use", id: "toolu_1", name: "bash", input: { command: "find . -name '*.md'" } },
        ],
      },
      1,
      current,
    )

    expect(first.parts).toHaveLength(1)
    expect(first.parts[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        callID: "toolu_1",
        state: expect.objectContaining({
          status: "running",
          input: { command: "find . -name '*.md'" },
        }),
      }),
    )

    current.set(first.parts[0]!.callID, first.parts[0]!)

    const second = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "AGENTS.md\nTOOLS.md" }],
      },
      2,
      current,
    )

    expect(second.parts).toHaveLength(1)
    expect(second.parts[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        callID: "toolu_1",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "find . -name '*.md'" },
          output: "AGENTS.md\nTOOLS.md",
        }),
      }),
    )
  })

  test("parses real toolCall payloads from desktop logs", () => {
    const current = new Map<string, ToolPart>()
    const next = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_real_1",
            name: "exec",
            arguments: { cmd: "find . -type f" },
          },
        ],
      },
      1,
      current,
    )

    expect(next.parts).toHaveLength(1)
    expect(next.parts[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        tool: "exec",
        callID: "call_real_1",
        state: expect.objectContaining({
          status: "running",
          input: { cmd: "find . -type f" },
        }),
      }),
    )
  })

  test("parses single object payloads for live tool results", () => {
    const current = new Map<string, ToolPart>()
    current.set(
      "call_real_1",
      OpenClawBridge.internal.streamParts(
        "msg_1",
        "sess",
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_real_1",
              name: "exec",
              arguments: { cmd: "pwd" },
            },
          ],
        },
        1,
      ).parts[0]!,
    )

    const next = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: {
          type: "toolResult",
          toolCallId: "call_real_1",
          result: "/tmp/project",
        },
      },
      2,
      current,
    )

    expect(next.parts).toHaveLength(1)
    expect(next.parts[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        tool: "exec",
        callID: "call_real_1",
        state: expect.objectContaining({
          status: "completed",
          input: { cmd: "pwd" },
          output: "/tmp/project",
        }),
      }),
    )
  })

  test("does not downgrade a completed tool back to running on repeated toolCall payloads", () => {
    const current = new Map<string, ToolPart>()
    const done = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: {
          type: "toolResult",
          toolCallId: "call_real_1",
          result: "2026-03-25",
        },
      },
      2,
      current,
    )

    current.set("call_real_1", {
      id: done.parts[0]!.id,
      sessionID: "sess",
      messageID: "msg_1",
      type: "tool",
      callID: "call_real_1",
      tool: "exec",
      state: {
        status: "completed",
        input: { command: "date +%F" },
        output: "2026-03-25",
        title: "Exec",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    })

    const repeated = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_real_1",
            name: "exec",
            arguments: { command: "date +%F" },
          },
        ],
      },
      3,
      current,
    )

    expect(repeated.parts).toHaveLength(1)
    expect(repeated.parts[0]).toEqual(
      expect.objectContaining({
        type: "tool",
        callID: "call_real_1",
        state: expect.objectContaining({
          status: "completed",
          output: "2026-03-25",
        }),
      }),
    )
  })

  test("matches current assistant message by parent id even if gateway timestamp is older than started", () => {
    const sessionID = "sess"
    const userID = `${sessionID}-m0000000000001-0000`
    const assistantID = `${sessionID}-m0000000000001-0001`
    const list = OpenClawBridge.internal.historyMessages(sessionID, [
      {
        role: "user",
        content: [{ type: "text", text: "check memory" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: { cmd: "ps aux" } }],
        timestamp: 1,
        provider: "axonhub",
        model: "gpt-5.4",
      },
    ] as any)

    expect(list).toHaveLength(2)
    const hit = OpenClawBridge.internal.current(list, { parentID: userID, messageID: assistantID }, 2)
    expect(hit?.info.id).toBe(assistantID)
    expect(hit?.info.parentID).toBe(userID)
  })

  test("finds real user anchor by prompt text and nearest time", () => {
    const sessionID = "sess"
    const list = OpenClawBridge.internal.historyMessages(sessionID, [
      {
        role: "user",
        content: [{ type: "text", text: "old prompt" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "old reply" }],
        timestamp: 2,
      },
      {
        role: "user",
        content: [{ type: "text", text: "kill main_v2" }],
        timestamp: 10,
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: { cmd: "kill 1" } }],
        timestamp: 11,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: 12,
      },
    ] as any)

    const anchor = OpenClawBridge.internal.source(list, { parentID: "optimistic", prompt: "kill main_v2" }, 10)
    expect(anchor).toBe(list[2]?.info.id)
  })

  test("changes stamp when a tool part moves from running to completed", () => {
    const running = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_real_1",
            name: "exec",
            arguments: { command: "date +%F" },
          },
        ],
      },
      1,
    ).parts[0]!

    const done = OpenClawBridge.internal.streamParts(
      "msg_1",
      "sess",
      {
        role: "assistant",
        content: {
          type: "toolResult",
          toolCallId: "call_real_1",
          result: "2026-03-25",
        },
      },
      2,
      new Map([["call_real_1", running]]),
    ).parts[0]!

    expect(
      OpenClawBridge.internal.stamp({
        info: { id: "msg_1" },
        parts: [running],
      } as any),
    ).not.toBe(
      OpenClawBridge.internal.stamp({
        info: { id: "msg_1" },
        parts: [done],
      } as any),
    )
  })
})
