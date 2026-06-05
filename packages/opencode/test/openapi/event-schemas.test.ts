import { describe, expect, test } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime, Schema } from "effect"
import { OpenCodeHttpApi } from "../../src/server/routes/instance/httpapi/api"

const requiredEventTypes = [
  "session.next.prompted",
  "session.next.step.started",
  "session.next.text.ended",
  "session.next.tool.success",
  "session.next.compaction.ended",
] as const

describe("OpenAPI EventV2 schemas", () => {
  test("snapshots EventV2 registry after HTTP API imports register event producers", () => {
    expect(OpenCodeHttpApi).toBeDefined()

    for (const type of requiredEventTypes) {
      expect(EventV2.registry.get(type), `${type} should be present in the exported event schema registry`).toBeDefined()
    }

    const registryOrder = EventV2.definitions().map((definition) => definition.type)
    const requiredIndexes = requiredEventTypes.map((type) => registryOrder.indexOf(type))

    expect(requiredIndexes.every((index) => index >= 0)).toBe(true)
    expect(requiredIndexes).toEqual([...requiredIndexes].sort((a, b) => a - b))
  })

  test("keeps assistant message content as typed content entries with canonical evt ids", () => {
    const encoded = Schema.encodeUnknownSync(SessionMessage.Message)(new SessionMessage.Assistant({
      id: SessionMessage.ID.make("msg_assistant"),
      type: "assistant",
      agent: "general",
      model: {
        providerID: ProviderV2.ID.make("anthropic"),
        id: ModelV2.ID.make("claude"),
        variant: ModelV2.VariantID.make("default"),
      },
      content: [
        new SessionMessage.AssistantText({ type: "text", id: "txt_1", text: "hello" }),
        new SessionMessage.AssistantReasoning({
          type: "reasoning",
          id: "rsn_1",
          text: "thinking",
        }),
        new SessionMessage.AssistantTool({
          type: "tool",
          id: "call_1",
          name: "read",
          state: new SessionMessage.ToolStatePending({ status: "pending", input: "{}" }),
          time: { created: DateTime.makeUnsafe(1234) },
        }),
      ],
      time: { created: DateTime.makeUnsafe(1234) },
    })) as Record<string, unknown>

    expect(encoded).toMatchObject({ id: "msg_assistant", type: "assistant" })
    expect(encoded).not.toHaveProperty("parts")
    expect(encoded.content).toEqual([
      { type: "text", id: "txt_1", text: "hello" },
      { type: "reasoning", id: "rsn_1", text: "thinking" },
      {
        type: "tool",
        id: "call_1",
        name: "read",
        state: { status: "pending", input: "{}" },
        time: { created: 1234 },
      },
    ])
  })
})
