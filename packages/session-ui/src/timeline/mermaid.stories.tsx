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

export const StateGraph = {
  render: () => <StateGraphTimeline />,
}

// Wide enough that its labels are too small to read inline, which is what the maximized view is for.
const SESSION_STATES = `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Running: wake() or resume()
  state Running {
    direction LR
    [*] --> Boundary
    Boundary --> Step: next step to continue
    Boundary --> Compact: context over the limit
    Boundary --> Drain: inbox has queued items
    Step --> Boundary: step finished
    Compact --> Boundary: summary written
    Drain --> Boundary: item admitted
  }
  Running --> Stopping: interrupt() or cancel
  Stopping --> Settled: fiber exits
  Running --> Settled: no step and an empty inbox
  Running --> Suspended: waiting for a permission or question
  Suspended --> Running: answered
  Running --> Failed: unrecoverable error
  Settled --> Idle: execution.ended published
  Failed --> Idle: execution.ended with an error`

function StateGraphTimeline() {
  const document: SessionDocument = {
    sessionID: CURRENT_SESSION_ID,
    status: { type: "idle" },
    diffs: [],
    messages: [
      {
        id: "msg_state_graph_user",
        type: "user",
        text: "Show me the state graph of a session.",
        time: { created: STORY_TIME },
        metadata: { agent: "build", model: STORY_MODEL },
      },
      {
        id: "msg_state_graph_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        time: { created: STORY_TIME + 100, completed: STORY_TIME + 1000 },
        content: [{ type: "text", text: "## State graph\n\n```mermaid\n" + SESSION_STATES + "\n```" }],
      },
    ],
  }

  return (
    <section class="mx-auto flex w-full max-w-[840px] flex-col gap-4 p-6">
      <CurrentSessionProviders document={document}>
        <SessionTimeline document={document} />
      </CurrentSessionProviders>
    </section>
  )
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
          time: { created: STORY_TIME + 100, completed: completed() ? STORY_TIME + 1000 : undefined },
          content: [
            {
              type: "text",
              text: [
                "## Request flow",
                "```mermaid\nflowchart LR\n Client[Client] --> Server[Server]\n Server --> Model[Model]\n```",
                "## Request sequence",
                "```mermaid\nsequenceDiagram\n Client->>Server: Send prompt\n Server->>Model: Generate response\n Model-->>Client: Response\n" +
                  (completed() ? "```" : ""),
              ].join("\n\n"),
              native: completed() ? undefined : { phase: "streaming" },
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
