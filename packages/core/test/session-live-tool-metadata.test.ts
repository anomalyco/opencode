import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { LiveToolMetadata } from "@opencode/core/session/runner/live-tool-metadata"
import { DateTime } from "effect"

const id = SessionMessage.ID.create()

const message = (state: SessionMessage.ToolState) =>
  SessionMessage.Assistant.make({
    id,
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    content: [
      SessionMessage.AssistantTool.make({
        type: "tool",
        id: "call_1",
        name: "execute",
        state,
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ],
    time: { created: DateTime.makeUnsafe(0) },
  })

const running = message({ status: "running", input: {}, metadata: {} })
const completed = message({ status: "completed", input: {}, content: [{ type: "text", text: "done" }] })

describe("LiveToolMetadata.overlay", () => {
  test("adds progress to running tool parts until the call settles", () => {
    LiveToolMetadata.set(id, "call_1", { background: true, toolCalls: [] })
    expect(LiveToolMetadata.overlay(running)).toMatchObject({
      content: [{ state: { status: "running", metadata: { background: true, toolCalls: [] } } }],
    })
    expect(LiveToolMetadata.overlay(completed)).toEqual(completed)

    LiveToolMetadata.clear(id, "call_1")
    expect(LiveToolMetadata.overlay(running)).toEqual(running)
  })
})
