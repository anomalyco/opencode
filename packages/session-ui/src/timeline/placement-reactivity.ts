import type { SessionMessageInfo, SessionStatus } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { storyTool } from "../storybook/current-session-scenarios"
import type { TimelineRow } from "./timeline-row"

// Counts how often a projection rebuilds its rows while calls stream input and report progress, and once after a call
// moves. Streaming input and progress metadata change many times a second without moving a call.

type Tool = Extract<Extract<SessionMessageInfo, { type: "assistant" }>["content"][number], { type: "tool" }>

const source = (): SessionMessageInfo[] => [
  { id: "msg_u", type: "user", text: "go", time: { created: 1 } },
  {
    id: "msg_a",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 2 },
    content: [
      storyTool("write", "write", "streaming", {}, { raw: '{"path":"/repo/a.ts","content":"a' }),
      storyTool("edit", "edit", "streaming", {}, { raw: '{"path":"/repo/b.ts","oldString":"b' }),
      storyTool("execute", "execute", "streaming", {}, { raw: '{"code":"1' }),
      storyTool("shell", "shell", "running", { command: "make" }, { metadata: { output: "a" } }),
      storyTool("subagent", "subagent", "running", { description: "look" }, { metadata: { sessionID: "ses_c" } }),
    ],
  },
]

export function projectionRuns(
  build: (messages: () => SessionMessageInfo[], status: () => SessionStatus) => () => TimelineRow.TimelineRow[],
) {
  return createRoot((dispose) => {
    const [store, setStore] = createStore({ messages: source() })
    let count = 0

    const rows = build(
      () => store.messages,
      () => {
        count++

        return { type: "busy" }
      },
    )

    const edit = (index: number, change: (tool: Tool) => void) =>
      setStore(
        produce((state) => {
          const message = state.messages[1]
          const tool = message?.type === "assistant" ? message.content[index] : undefined

          if (tool?.type === "tool") change(tool)
        }),
      )

    rows()
    const before = count

    for (let step = 0; step < 5; step++) {
      edit(0, (tool) => tool.state.status === "streaming" && (tool.state.input += "a"))
      edit(1, (tool) => tool.state.status === "streaming" && (tool.state.input += "b"))
      edit(2, (tool) => tool.state.status === "streaming" && (tool.state.input += "1"))
      edit(3, (tool) => tool.state.status === "running" && (tool.state.metadata = { output: "a".repeat(step + 2) }))
      edit(4, (tool) => tool.state.status === "running" && (tool.state.metadata = { sessionID: "ses_c", step }))
      rows()
    }

    const streamed = count
    edit(
      3,
      (tool) =>
        (tool.state = {
          status: "completed",
          input: { command: "make" },
          content: [{ type: "text", text: "" }],
          metadata: {},
        }),
    )
    rows()
    const moved = count
    dispose()

    return { streamed: streamed - before, moved: moved - streamed }
  })
}
