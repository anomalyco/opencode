import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { DateTime } from "effect"

type ToolContent = SessionMessage.ToolStateCompleted["content"]

const ref = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const assistant = (content: ToolContent) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: ref,
    content: [
      SessionMessage.AssistantTool.make({
        type: "tool",
        id: "call_1",
        name: "execute",
        state: { status: "completed", input: {}, content, metadata: {} },
        time: { created: DateTime.makeUnsafe(0), ran: DateTime.makeUnsafe(0) },
      }),
    ],
    time: { created: DateTime.makeUnsafe(0) },
  })

const result = (content: ToolContent) => {
  const [, tool] = toLLMMessages([assistant(content)], ref)
  return tool.content[0] as { type: "tool-result"; result: { type: string; value: unknown } }
}

// A provider that refuses an empty tool message also fails every later request in the session, because the
// same stored history is replayed, so what the model is given may never be whitespace-only.
describe("empty tool output", () => {
  test("a tool that produced nothing reaches the model as a stated absence of output", () => {
    expect(result([{ type: "text", text: "" }]).result).toEqual({ type: "text", value: "(no output)" })
    expect(result([{ type: "text", text: "\n" }]).result).toEqual({ type: "text", value: "(no output)" })
    expect(result([{ type: "text", text: " \n\t " }]).result).toEqual({ type: "text", value: "(no output)" })
  })

  test("output is left untouched once it says anything", () => {
    expect(result([{ type: "text", text: "done" }]).result).toEqual({ type: "text", value: "done" })
    expect(result([{ type: "text", text: " padded " }]).result).toEqual({ type: "text", value: " padded " })
  })

  test("a result with an attachment keeps it as is", () => {
    expect(
      result([
        { type: "text", text: "\n" },
        { type: "file", uri: "file:///tmp/plot.png", mime: "image/png" },
      ]).result,
    ).toEqual({
      type: "content",
      value: [
        { type: "text", text: "\n" },
        { type: "file", uri: "file:///tmp/plot.png", mime: "image/png" },
      ],
    })
  })
})
