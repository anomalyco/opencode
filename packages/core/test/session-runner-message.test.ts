import { describe, expect, test } from "bun:test"
import { Message, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { AgentAttachment, FileAttachment } from "@opencode-ai/core/session/prompt"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { SessionV2 } from "@opencode-ai/core/session"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.make({ id: "model", provider: "provider", route: OpenAIChat.route })

describe("toLLMMessages", () => {
  test("omits empty assistant turns", () => {
    const assistant = (value: string, content: SessionMessage.Assistant["content"]) =>
      SessionMessage.Assistant.make({
        id: id(value),
        type: "assistant",
        agent: "build",
        model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
        content,
        time: { created, completed: created },
      })
    const messages = toLLMMessages(
      [
        assistant("empty", []),
        assistant("empty-text", [SessionMessage.AssistantText.make({ type: "text", id: "empty", text: "" })]),
        assistant("empty-reasoning", [
          SessionMessage.AssistantReasoning.make({ type: "reasoning", id: "empty-reasoning", text: "" }),
        ]),
        assistant("text", [SessionMessage.AssistantText.make({ type: "text", id: "text", text: "Partial" })]),
        assistant("reasoning", [
          SessionMessage.AssistantReasoning.make({
            type: "reasoning",
            id: "reasoning",
            text: "",
            providerMetadata: { anthropic: { signature: "sig_1" } },
          }),
        ]),
      ],
      model,
    )

    expect(messages.map((message) => message.id)).toEqual([id("text"), id("reasoning")])
  })

  test("maps every top-level V2 Session message type", () => {
    const file = FileAttachment.make({ uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "hello.png" })
    const messages = toLLMMessages(
      [
        SessionMessage.AgentSwitched.make({
          id: id("agent"),
          type: "agent-switched",
          agent: "build",
          time: { created },
        }),
        SessionMessage.ModelSwitched.make({
          id: id("model"),
          type: "model-switched",
          model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
          time: { created },
        }),
        SessionMessage.System.make({
          id: id("system"),
          type: "system",
          text: "Updated context\n\nOther context",
          time: { created },
        }),
        SessionMessage.User.make({
          id: id("user"),
          type: "user",
          text: "Inspect this image",
          files: [file],
          agents: [AgentAttachment.make({ name: "build" })],
          time: { created },
        }),
        SessionMessage.Synthetic.make({
          id: id("synthetic"),
          type: "synthetic",
          sessionID: SessionV2.ID.make("ses_translate"),
          text: "Synthetic context",
          time: { created },
        }),
        SessionMessage.Shell.make({
          id: id("shell"),
          type: "shell",
          callID: "shell-1",
          command: "pwd",
          output: "/project",
          time: { created, completed: created },
        }),
        SessionMessage.Compaction.make({
          id: id("compaction"),
          type: "compaction",
          reason: "auto",
          summary: "Earlier work",
          recent: "Recent work",
          time: { created },
        }),
      ],
      model,
    )

    expect(messages.map((message) => message.role)).toEqual(["system", "user", "user", "user", "user"])
    expect(messages[0]).toEqual(Message.system("Updated context\n\nOther context"))
    expect(messages[1]).toEqual(
      Message.make({
        id: id("user"),
        role: "user",
        content: [
          { type: "text", text: "Inspect this image" },
          { type: "media", mediaType: "image/png", data: "data:image/png;base64,aGVsbG8=", filename: "hello.png" },
        ],
        metadata: { agents: [{ name: "build" }] },
      }),
    )
    expect(messages.slice(2).map((message) => message.content)).toEqual([
      [{ type: "text", text: "Synthetic context" }],
      [{ type: "text", text: "Shell command: pwd\n\n/project" }],
      [
        {
          type: "text",
          text: `<conversation-checkpoint>
The following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.

<summary>
Earlier work
</summary>

<recent-context>
Recent work
</recent-context>
</conversation-checkpoint>`,
        },
      ],
    ])
  })

  test("replays durable tool media into canonical tool messages without structured base64", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Assistant.make({
          id: id("assistant"),
          type: "assistant",
          agent: "build",
          model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
          content: [
            SessionMessage.AssistantText.make({ type: "text", id: "text-1", text: "Checking" }),
            SessionMessage.AssistantReasoning.make({
              type: "reasoning",
              id: "reasoning-1",
              text: "Think",
              providerMetadata: { anthropic: { signature: "sig_1" } },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "pending",
              name: "read",
              state: SessionMessage.ToolStatePending.make({ status: "pending", input: '{"path":"README.md"}' }),
              time: { created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "running",
              name: "read",
              state: SessionMessage.ToolStateRunning.make({
                status: "running",
                input: { path: "README.md" },
                content: [],
                structured: { type: "media", mime: "image/png" },
              }),
              time: { created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "completed",
              name: "read",
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { path: "README.md" },
                content: [
                  { type: "text", text: "Hello" },
                  {
                    type: "file",
                    uri: "data:image/png;base64,aGVsbG8=",
                    mime: "image/png",
                    name: "hello.png",
                  },
                ],
                structured: {},
              }),
              time: { created, completed: created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "hosted",
              name: "web_search",
              provider: {
                executed: true,
                metadata: { fake: { continuation: "hosted-call" } },
                resultMetadata: { fake: { continuation: "hosted-result" } },
              },
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { query: "Effect" },
                content: [{ type: "text", text: "Found it" }],
                structured: {},
              }),
              time: { created, completed: created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "hosted-failed",
              name: "write",
              provider: { executed: true, metadata: { fake: { continuation: "failed" } } },
              state: SessionMessage.ToolStateError.make({
                status: "error",
                input: { path: "README.md" },
                content: [],
                structured: {},
                error: { type: "unknown", message: "Denied" },
              }),
              time: { created, completed: created },
            }),
          ],
          time: { created, completed: created },
        }),
      ],
      model,
    )

    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool"])
    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Checking" },
      { type: "reasoning", text: "Think", providerMetadata: { anthropic: { signature: "sig_1" } } },
      { type: "tool-call", id: "pending", name: "read", input: { path: "README.md" } },
      { type: "tool-call", id: "running", name: "read", input: { path: "README.md" } },
      {
        type: "tool-call",
        id: "completed",
        name: "read",
        input: { path: "README.md" },
      },
      {
        type: "tool-call",
        id: "hosted",
        name: "web_search",
        input: { query: "Effect" },
        providerExecuted: true,
        providerMetadata: { fake: { continuation: "hosted-call" } },
      },
      {
        type: "tool-result",
        id: "hosted",
        name: "web_search",
        providerExecuted: true,
        providerMetadata: { fake: { continuation: "hosted-result" } },
        result: { type: "text", value: "Found it" },
      },
      {
        type: "tool-call",
        id: "hosted-failed",
        name: "write",
        input: { path: "README.md" },
        providerExecuted: true,
        providerMetadata: { fake: { continuation: "failed" } },
      },
      {
        type: "tool-result",
        id: "hosted-failed",
        name: "write",
        providerExecuted: true,
        providerMetadata: { fake: { continuation: "failed" } },
        result: {
          type: "error",
          value: { error: { type: "unknown", message: "Denied" }, content: [], structured: {} },
        },
      },
    ])
    expect(messages[1]?.content).toEqual([
      {
        type: "tool-result",
        id: "completed",
        name: "read",
        result: {
          type: "content",
          value: [
            { type: "text", text: "Hello" },
            { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "hello.png" },
          ],
        },
      },
    ])
  })

  test("restores OpenAI encrypted reasoning metadata", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Assistant.make({
          id: id("assistant-openai-reasoning"),
          type: "assistant",
          agent: "build",
          model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
          content: [
            SessionMessage.AssistantReasoning.make({
              type: "reasoning",
              id: "reasoning-openai",
              text: "Think",
              providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
            }),
          ],
          time: { created, completed: created },
        }),
      ],
      model,
    )

    expect(messages[0]?.content).toEqual([
      {
        type: "reasoning",
        text: "Think",
        providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
      },
    ])
  })

  test("drops provider-native continuation metadata from failed assistant turns", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Assistant.make({
          id: id("assistant-failed"),
          type: "assistant",
          agent: "build",
          model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
          content: [
            SessionMessage.AssistantReasoning.make({
              type: "reasoning",
              id: "reasoning-failed",
              text: "Partial thought",
              providerMetadata: { openai: { itemId: "rs_failed", reasoningEncryptedContent: null } },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "hosted-failed",
              name: "web_search",
              provider: {
                executed: true,
                metadata: { openai: { itemId: "call_failed" } },
                resultMetadata: { openai: { itemId: "result_failed" } },
              },
              state: SessionMessage.ToolStateError.make({
                status: "error",
                input: { query: "Effect" },
                error: { type: "unknown", message: "Provider turn interrupted" },
                content: [],
                structured: {},
              }),
              time: { created, completed: created },
            }),
          ],
          finish: "error",
          error: { type: "unknown", message: "Provider turn interrupted" },
          time: { created, completed: created },
        }),
      ],
      model,
    )

    expect(messages[0]?.content).toEqual([
      { type: "reasoning", text: "Partial thought", providerMetadata: undefined },
      {
        type: "tool-call",
        id: "hosted-failed",
        name: "web_search",
        input: { query: "Effect" },
        providerExecuted: true,
        providerMetadata: undefined,
      },
      {
        type: "tool-result",
        id: "hosted-failed",
        name: "web_search",
        result: {
          type: "error",
          value: {
            error: { type: "unknown", message: "Provider turn interrupted" },
            content: [],
            structured: {},
          },
        },
        providerExecuted: true,
        cache: undefined,
        metadata: undefined,
        providerMetadata: undefined,
      },
    ])
  })

  test("drops provider-native continuation metadata after a model switch", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Assistant.make({
          id: id("assistant-old-model"),
          type: "assistant",
          agent: "build",
          model: { id: ModelV2.ID.make("old-model"), providerID: ProviderV2.ID.make("provider") },
          content: [
            SessionMessage.AssistantReasoning.make({
              type: "reasoning",
              id: "reasoning-old-model",
              text: "Visible thought",
              providerMetadata: { anthropic: { signature: "sig_old" } },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "hosted-old-model",
              name: "web_search",
              provider: {
                executed: true,
                metadata: { openai: { itemId: "hosted-old-model" } },
                resultMetadata: { openai: { itemId: "hosted-old-model" } },
              },
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { query: "Effect" },
                content: [],
                structured: {},
                result: { type: "json", value: { status: "completed" } },
              }),
              time: { created, completed: created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "local-old-model",
              name: "read",
              provider: {
                executed: false,
                metadata: { fake: { call: "old" } },
                resultMetadata: { fake: { result: "old" } },
              },
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { path: "README.md" },
                content: [],
                structured: { text: "Hello" },
              }),
              time: { created, completed: created },
            }),
          ],
          time: { created, completed: created },
        }),
      ],
      model,
    )

    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Visible thought" },
      {
        type: "tool-call",
        id: "hosted-old-model",
        name: "web_search",
        input: { query: "Effect" },
        providerExecuted: true,
        providerMetadata: undefined,
      },
      {
        type: "tool-result",
        id: "hosted-old-model",
        name: "web_search",
        result: { type: "json", value: { status: "completed" } },
        providerExecuted: true,
        cache: undefined,
        metadata: undefined,
        providerMetadata: undefined,
      },
      {
        type: "tool-call",
        id: "local-old-model",
        name: "read",
        input: { path: "README.md" },
        providerExecuted: false,
        providerMetadata: undefined,
      },
    ])
    expect(messages[1]?.content).toEqual([
      {
        type: "tool-result",
        id: "local-old-model",
        name: "read",
        result: { type: "json", value: { text: "Hello" } },
        providerExecuted: false,
        cache: undefined,
        metadata: undefined,
        providerMetadata: undefined,
      },
    ])
  })
})
