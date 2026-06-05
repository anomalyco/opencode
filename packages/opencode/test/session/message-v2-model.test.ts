import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { FileAttachment } from "@opencode-ai/core/session/prompt"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { DateTime } from "effect"
import { MessageV2Model } from "../../src/session/message-v2-model"

const model = {
  providerID: ProviderV2.ID.make("provider"),
  id: ModelV2.ID.make("model"),
  variant: ModelV2.VariantID.make("default"),
}

function id(suffix: string) {
  return SessionMessage.ID.make(`msg_${suffix}`)
}

function user(suffix: string, time: number, input: Partial<SessionMessage.User>): SessionMessage.User {
  return new SessionMessage.User({
    id: id(suffix),
    type: "user",
    text: "",
    files: [],
    agents: [],
    references: [],
    time: { created: DateTime.makeUnsafe(time) },
    ...input,
  })
}

function assistant(
  suffix: string,
  time: number,
  content: SessionMessage.AssistantContent[],
  input?: Partial<SessionMessage.Assistant>,
): SessionMessage.Assistant {
  return new SessionMessage.Assistant({
    id: id(suffix),
    type: "assistant",
    agent: "build",
    model,
    content,
    time: { created: DateTime.makeUnsafe(time) },
    ...input,
  })
}

function completedTool(input?: Partial<SessionMessage.AssistantTool>): SessionMessage.AssistantTool {
  return new SessionMessage.AssistantTool({
    id: "call-1",
    type: "tool",
    name: "bash",
    time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
    state: new SessionMessage.ToolStateCompleted({
      status: "completed",
      input: { cmd: "ls" },
      structured: {},
      content: [new ToolOutput.TextContent({ type: "text", text: "ok" })],
    }),
    ...input,
  })
}

describe("session.message-v2-model.toModelMessages", () => {
  test("converts user text and files", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        user("user", 1, {
          text: "hello",
          files: [new FileAttachment({ uri: "data:image/png;base64,Zm9v", mime: "image/png", name: "image.png" })],
        }),
      ]),
    ).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "file", mediaType: "image/png", filename: "image.png", data: "data:image/png;base64,Zm9v" },
        ],
      },
    ])
  })

  test("converts assistant text and reasoning", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [
          new SessionMessage.AssistantText({ id: id("text"), type: "text", text: "answer" }),
          new SessionMessage.AssistantReasoning({
            id: id("reasoning"),
            type: "reasoning",
            text: "thinking",
          }),
        ]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking", providerOptions: undefined },
        ],
      },
    ])
  })

  test("skips non-aborted errored assistant turns", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant(
          "api-error",
          1,
          [new SessionMessage.AssistantText({ id: id("api-text"), type: "text", text: "do not replay" })],
          { error: { type: "unknown", message: "failed" } },
        ),
        assistant(
          "unknown-error",
          2,
          [new SessionMessage.AssistantText({ id: id("unknown-text"), type: "text", text: "also skip" })],
          { error: { type: "unknown", message: "failed" } },
        ),
      ]),
    ).toStrictEqual([])
  })

  test("skips errored assistant turns", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant(
          "aborted",
          1,
          [new SessionMessage.AssistantText({ id: id("aborted-text"), type: "text", text: "partial answer" })],
          { error: { type: "unknown", message: "stopped" } },
        ),
      ]),
    ).toStrictEqual([])
  })

  test("converts completed tool text output to tool-call and tool-result messages", async () => {
    expect(await MessageV2Model.toModelMessages([assistant("assistant", 1, [completedTool()])])).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ])
  })

  test("converts completed tool file content from ToolOutput.FileContent without attachments field", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [
          completedTool({
            state: new SessionMessage.ToolStateCompleted({
              status: "completed",
              input: { path: "image.png" },
              structured: {},
              content: [
                new ToolOutput.TextContent({ type: "text", text: "read image" }),
                new ToolOutput.FileContent({
                  type: "file",
                  source: { type: "data", data: "Zm9v" },
                  mime: "image/png",
                  name: "image.png",
                }),
              ],
            }),
          }),
        ]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { path: "image.png" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: {
              type: "content",
              value: [
                { type: "text", text: "read image" },
                { type: "media", mediaType: "image/png", data: "Zm9v" },
              ],
            },
          },
        ],
      },
    ])
  })

  test("skips non-data tool file content in model media output", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [
          completedTool({
            state: new SessionMessage.ToolStateCompleted({
              status: "completed",
              input: { path: "image.png" },
              structured: {},
              content: [
                new ToolOutput.TextContent({ type: "text", text: "read image" }),
                new ToolOutput.FileContent({
                  type: "file",
                  source: { type: "file", uri: "file:///tmp/image.png" },
                  mime: "image/png",
                  name: "image.png",
                }),
              ],
            }),
          }),
        ]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { path: "image.png" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "content", value: [{ type: "text", text: "read image" }] },
          },
        ],
      },
    ])
  })

  test("uses legacy placeholder for pruned completed tool output", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [completedTool({ time: { created: DateTime.makeUnsafe(2), pruned: DateTime.makeUnsafe(4) } })]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "[Old tool result content cleared]" },
          },
        ],
      },
    ])
  })

  test("converts pending and running tools to interruption error results", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [
          new SessionMessage.AssistantTool({
            id: "call-pending",
            type: "tool",
            name: "bash",
            time: { created: DateTime.makeUnsafe(2) },
            state: new SessionMessage.ToolStatePending({ status: "pending", input: "{\"cmd\":\"ls\"}" }),
          }),
          new SessionMessage.AssistantTool({
            id: "call-running",
            type: "tool",
            name: "read",
            time: { created: DateTime.makeUnsafe(3), ran: DateTime.makeUnsafe(4) },
            state: new SessionMessage.ToolStateRunning({
              status: "running",
              input: { path: "/tmp" },
              structured: {},
              content: [],
            }),
          }),
        ]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-pending",
            toolName: "bash",
            input: "{\"cmd\":\"ls\"}",
            providerExecuted: undefined,
          },
          {
            type: "tool-call",
            toolCallId: "call-running",
            toolName: "read",
            input: { path: "/tmp" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-pending",
            toolName: "bash",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
          {
            type: "tool-result",
            toolCallId: "call-running",
            toolName: "read",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
        ],
      },
    ])
  })

  test("converts tool errors to error-text tool results", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        assistant("assistant", 1, [
          new SessionMessage.AssistantTool({
            id: "call-error",
            type: "tool",
            name: "bash",
            time: { created: DateTime.makeUnsafe(2), ran: DateTime.makeUnsafe(3), completed: DateTime.makeUnsafe(4) },
            state: new SessionMessage.ToolStateError({
              status: "error",
              input: { cmd: "ls" },
              structured: {},
              content: [],
              error: { type: "unknown", message: "nope" },
            }),
          }),
        ]),
      ]),
    ).toStrictEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-error",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-error",
            toolName: "bash",
            output: { type: "error-text", value: "nope" },
          },
        ],
      },
    ])
  })

  test("sorts descending input into chronological model output", async () => {
    expect(
      await MessageV2Model.toModelMessages([
        user("second", 2, { text: "second" }),
        user("first", 1, { text: "first" }),
      ]),
    ).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ])
  })

  test("maps tool provider execution and metadata", async () => {
    const result = await MessageV2Model.toModelMessages([
      assistant(
        "assistant",
        1,
        [
          new SessionMessage.AssistantText({ id: id("text"), type: "text", text: "answer" }),
          new SessionMessage.AssistantReasoning({
            id: id("reasoning"),
            type: "reasoning",
            text: "thinking",
          }),
          completedTool({ provider: { executed: true, metadata: { openai: { signature: "deferred" } } } }),
        ],
        { metadata: { openai: { assistant: "deferred" } } },
      ),
    ])

    expect(result[0]).toStrictEqual({
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "reasoning", text: "thinking", providerOptions: undefined },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "bash",
          input: { cmd: "ls" },
          providerExecuted: true,
          providerOptions: { openai: { signature: "deferred" } },
        },
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "bash",
          output: { type: "text", value: "ok" },
          providerOptions: { openai: { signature: "deferred" } },
        },
      ],
    })
    expect(result[1]).toBeUndefined()
  })
})
