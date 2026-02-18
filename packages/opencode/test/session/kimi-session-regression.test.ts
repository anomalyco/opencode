import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

const model: Provider.Model = {
  id: "moonshotai/kimi-k2.5",
  providerID: "moonshotai",
  api: {
    id: "kimi-k2.5",
    url: "https://api.moonshot.ai/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Kimi K2.5",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: {
      field: "reasoning_content",
    },
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function user(id: string, text: string): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID: "session",
      role: "user",
      time: { created: 0 },
      agent: "agent",
      model: { providerID: model.providerID, modelID: model.api.id },
    } as MessageV2.User,
    parts: [
      {
        id: `part-${id}`,
        sessionID: "session",
        messageID: id,
        type: "text",
        text,
      },
    ],
  }
}

function assistantWithTool(input: {
  id: string
  parentID: string
  callID: string
  output: string
  withImage: boolean
}): MessageV2.WithParts {
  return {
    info: {
      id: input.id,
      sessionID: "session",
      role: "assistant",
      parentID: input.parentID,
      modelID: model.api.id,
      providerID: model.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 0 },
    } as MessageV2.Assistant,
    parts: [
      {
        id: `tool-${input.id}`,
        sessionID: "session",
        messageID: input.id,
        type: "tool",
        callID: input.callID,
        tool: "figma-desktop_get_screenshot",
        state: {
          status: "completed",
          input: { nodeId: "1:2" },
          output: input.output,
          title: "Screenshot",
          metadata: {},
          time: { start: 0, end: 1 },
          attachments: input.withImage
            ? [
                {
                  id: `file-${input.id}`,
                  sessionID: "session",
                  messageID: input.id,
                  type: "file",
                  mime: "image/png",
                  url: "data:image/png;base64,Zm9v",
                },
              ]
            : [],
        },
      } as MessageV2.ToolPart,
    ],
  }
}

describe("kimi screenshot regression", () => {
  test("does not keep empty tool result text in session history replay", () => {
    const messages: MessageV2.WithParts[] = [
      user("u1", "capture node"),
      assistantWithTool({
        id: "a1",
        parentID: "u1",
        callID: "call-1",
        output: "",
        withImage: true,
      }),
      user("u2", "capture node again"),
      assistantWithTool({
        id: "a2",
        parentID: "u2",
        callID: "call-2",
        output: "Captured node successfully",
        withImage: true,
      }),
    ]

    const out = MessageV2.toModelMessages(messages, model)
    const toolOutputs = out
      .filter((item) => item.role === "tool")
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((part) => part.type === "tool-result")
      .map((part) => part.output)

    expect(toolOutputs).toHaveLength(2)
    expect(toolOutputs[0]).toStrictEqual({
      type: "text",
      value: "[Tool produced non-text output; attachment included separately.]",
    })
    expect(toolOutputs[1]).toStrictEqual({
      type: "text",
      value: "Captured node successfully",
    })

    for (const output of toolOutputs) {
      if (output.type !== "text") continue
      expect(output.value.trim().length).toBeGreaterThan(0)
    }
  })
})
