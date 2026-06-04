import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"

describe("SessionMessage schema", () => {
  test("decodes stale completed tool attachments without keeping state.attachments", () => {
    const message = Schema.decodeUnknownSync(SessionMessage.Message)({
      id: "evt_assistant",
      type: "assistant",
      agent: "build",
      model: {
        providerID: ProviderV2.ID.make("test"),
        id: ModelV2.ID.make("test-model"),
      },
      content: [
        {
          type: "tool",
          id: "evt_tool",
          callID: "call_1",
          name: "read",
          state: {
            status: "completed",
            input: { file: "image.png" },
            attachments: [
              { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AAAA" },
            ],
            content: [{ type: "file", mime: "image/png", name: "image.png", uri: "data:image/png;base64,AAAA" }],
            structured: {},
          },
          time: { created: 1, completed: 2 },
        },
      ],
      time: { created: 1, completed: 2 },
    })

    expect(message.type).toBe("assistant")
    if (message.type !== "assistant") return
    const tool = message.content[0]
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("completed")
    if (tool.state.status !== "completed") return
    expect(tool.state.content).toEqual([
      { type: "file", mime: "image/png", name: "image.png", uri: "data:image/png;base64,AAAA" },
    ])
    expect(tool.state).not.toHaveProperty("attachments")
  })
})
