import { createMemo, createSignal } from "solid-js"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Mermaid diagrams",
  id: "current-session-mermaid",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

export const Diagrams = {
  args: { streaming: false },
  render: (args: { streaming: boolean }) => <MermaidTimeline streaming={args.streaming} />,
}

function MermaidTimeline(props: { streaming: boolean }) {
  const [completed, setCompleted] = createSignal(!props.streaming)
  const document = createMemo(
    (): SessionDocument => ({
      sessionID: CURRENT_SESSION_ID,
      status: { type: completed() ? "idle" : "busy" },
      diffs: [],
      messages: [
        {
          id: "msg_mermaid_user",
          type: "user",
          text: "Show the request flow and sequence as Mermaid diagrams.",
          time: { created: STORY_TIME },
          metadata: { agent: "build", model: STORY_MODEL },
        },
        {
          id: "msg_mermaid_assistant",
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          time: { created: STORY_TIME + 100, ...(completed() ? { completed: STORY_TIME + 1000 } : {}) },
          content: [
            {
              type: "text",
              text: [
                "## Request flow",
                "```mermaid\nflowchart LR\n Client[Client] --> Server[Server]\n Server --> Model[Model]\n```",
                "## Request sequence",
                [
                  "```mermaid",
                  "sequenceDiagram",
                  "    participant Agent",
                  "    participant Plugin as Server plugin",
                  "    participant Desktop",
                  "    participant Browser as Chromium",
                  "",
                  "    Agent->>Plugin: browser.network.get({ id })",
                  "    Plugin->>Plugin: Check permissions; create pending request",
                  "    Plugin-->>Desktop: Command available (request ID only)",
                  "    Desktop->>Plugin: command(request ID)",
                  "    Plugin-->>Desktop: Typed operation + input",
                  "    Desktop->>Browser: Read captured request",
                  "    Browser-->>Desktop: Data",
                  "    Desktop->>Plugin: result(request ID, outcome)",
                  "    Plugin->>Plugin: Validate against expected output",
                  "    Plugin-->>Agent: Structured result",
                  completed() ? "```" : "",
                ].join("\n"),
              ].join("\n\n"),
              ...(completed() ? {} : { state: { phase: "streaming" } }),
            },
          ],
        },
      ],
    }),
  )
  return (
    <section class="mx-auto flex w-full max-w-[840px] flex-col gap-4 p-6">
      <button type="button" onClick={() => setCompleted((value) => !value)}>
        {completed() ? "Stream response" : "Complete response"}
      </button>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}
