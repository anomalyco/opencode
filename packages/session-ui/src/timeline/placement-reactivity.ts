import type { SessionMessageInfo, SessionStatus } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { labTool } from "../lab/current-session-scenarios"
import type { TimelineRow } from "./timeline-row"

// Counts how often a projection rebuilds its rows while calls stream input and report progress, as a running script
// reports changes, and once after a call moves. Streaming input and progress metadata change many times a second without moving a call.

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
      labTool("write", "write", "streaming", {}, { raw: '{"path":"/repo/a.ts","content":"a' }),
      labTool("edit", "edit", "streaming", {}, { raw: '{"path":"/repo/b.ts","oldString":"b' }),
      labTool("execute", "execute", "streaming", {}, { raw: '{"code":"1' }),
      labTool("shell", "shell", "running", { command: "make" }, { metadata: { output: "a" } }),
      labTool("subagent", "subagent", "running", { description: "look" }, { metadata: { sessionID: "ses_c" } }),
      labTool("script", "execute", "running", { code: "await edit()" }, { metadata: { toolCalls: [] } }),
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
      edit(5, (tool) => {
        if (tool.state.status !== "running") return
        tool.state.metadata = {
          toolCalls: Array.from({ length: step + 1 }, () => ({ tool: "edit", status: "completed" })),
        }
      })
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

    // A running script places each change as it arrives, once, and a report that adds none moves nothing.
    const changes = [
      { file: "/repo/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n a\n+b\n" },
      { file: "/repo/b.ts", status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+b\n" },
    ]

    const report = (files: number, calls: number) =>
      edit(5, (tool) => {
        if (tool.state.status !== "running") return
        tool.state.metadata = {
          toolCalls: Array.from({ length: calls }, () => ({ tool: "edit", status: "completed" })),
          files: changes.slice(0, files),
        }
      })

    const changed: number[] = []

    for (let files = 1; files <= changes.length; files++) {
      const at = count
      report(files, files + 5)
      rows()
      report(files, files + 6)
      rows()
      changed.push(count - at)
    }

    const live = count
    // Finishing with the same changes settles its status, once.
    edit(
      5,
      (tool) =>
        (tool.state = {
          status: "completed",
          input: { code: "await edit()" },
          content: [{ type: "text", text: "" }],
          metadata: { toolCalls: [], files: changes },
        }),
    )
    rows()
    const scripted = count
    dispose()

    return { streamed: streamed - before, moved: moved - streamed, changed, scripted: scripted - live }
  })
}
