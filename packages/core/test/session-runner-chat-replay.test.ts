import { expect, test } from "bun:test"
import { ai, Auth } from "@opencode/ai/effect"
import { route } from "@opencode/ai/protocols/openai-chat"
import { compileRequest } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { DateTime, Effect } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })

test.each([model.providerID, Provider.ID.make("other-provider")])(
  "can continue on an OpenAI Chat model after a hosted tool ran (%s)",
  async (providerID) => {
    const target = Model.Ref.make({ id: Model.ID.make("chat-model"), providerID })
    const messages = toLLMMessages(
      [
        SessionMessage.User.make({
          id: id("hosted-request"),
          type: "user",
          text: "Find an example",
          time: { created },
        }),
        SessionMessage.Assistant.make({
          id: id("hosted-reply"),
          type: "assistant",
          agent: Agent.defaultID,
          model,
          finish: "stop",
          time: { created, completed: created },
          content: [
            SessionMessage.AssistantText.make({ type: "text", text: "Looking it up." }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "hosted-search",
              name: "web_search",
              executed: true,
              native: { itemId: "native-provider-state" },
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { query: "Effect" },
                content: [{ type: "text", text: "Found an Effect example." }],
              }),
              time: { created, ran: created, completed: created },
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "local-read",
              name: "read",
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: { path: "README.md" },
                content: [{ type: "text", text: "Local README" }],
              }),
              time: { created, ran: created, completed: created },
            }),
            SessionMessage.AssistantText.make({ type: "text", text: "Here is the example." }),
          ],
        }),
        SessionMessage.User.make({
          id: id("hosted-followup"),
          type: "user",
          text: "Tell me more",
          time: { created },
        }),
      ],
      target,
    )
    const chat = route.with({ endpoint: { baseURL: "https://chat.test/v1" }, auth: Auth.bearer("test") })
    const prepared = await Effect.runPromise(
      compileRequest(ai.request({ model: chat.model({ id: target.id }), messages })),
    )

    expect(JSON.stringify(prepared.body)).not.toContain("native-provider-state")
    expect(prepared.body).toMatchObject({
      messages: [
        { role: "user", content: "Find an example" },
        {
          role: "assistant",
          content: "Looking it up.Here is the example.",
          tool_calls: [{ id: "local-read", function: { name: "read" } }],
        },
        { role: "tool", tool_call_id: "local-read", content: "Local README" },
        {
          role: "user",
          content: [
            { type: "text", text: "Historical provider tool data (recorded output):" },
            { type: "text", text: expect.stringContaining('"query":"Effect"') },
            { type: "text", text: expect.stringContaining("Found an Effect example.") },
          ],
        },
        { role: "user", content: "Tell me more" },
      ],
    })
  },
)
