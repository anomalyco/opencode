import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { createSessionBackground } from "./background"

test("retains legacy subagent IDs from tool metadata", () => {
  createRoot((dispose) => {
    const background = createSessionBackground({
      sessionID: () => SessionID.make("ses_parent"),
      messages: () => [
        {
          id: SessionMessage.ID.make("msg_parent"),
          type: "assistant",
          agent: Agent.ID.make("build"),
          model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
          time: { created: 0, completed: 1 },
          content: [
            {
              type: "tool",
              id: "call_child",
              name: "subagent",
              time: { created: 0 },
              state: {
                status: "completed",
                content: [{ type: "text", text: "" }],
                input: { description: "Earlier child", agent: "explore" },
                metadata: { status: "running", sessionID: "legacy-child" },
              },
            },
          ],
        },
      ],
      sessions: () => [],
      status: () => "idle",
      shells: () => [],
    })
    expect(background.tasks()).toEqual([
      {
        id: SessionID.make("legacy-child", { disableChecks: true }),
        type: "subagent",
        label: "Earlier child",
        agent: "explore",
      },
    ])
    dispose()
  })
})
