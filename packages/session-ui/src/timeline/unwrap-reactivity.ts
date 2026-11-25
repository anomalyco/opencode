import type { JsonValue, SessionMessageInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { storyTool } from "../storybook/current-session-scenarios"

// Counts how often a projection rebuilds its rows while an unwrapped script reports progress (`unwrapExecute`): a
// report that repeats what is known, one that starts a call, and one that finishes it.

const session = (script: ReturnType<typeof storyTool>): SessionMessageInfo[] => [
  { id: "msg_u", type: "user", text: "go", time: { created: 1 } },
  {
    id: "msg_a",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 2 },
    content: [{ type: "text", text: "Running." }, script],
  },
]

/** Counts the projection's rebuilds by its reads of the status, which only a rebuild reads. */
export const unwrapRuns = (
  build: (messages: () => SessionMessageInfo[], status: () => { type: "busy" }) => () => unknown[],
) =>
  createRoot((dispose) => {
    const running = storyTool("script", "execute", "running", { code: "…" }, { metadata: { toolCalls: [] } })
    const [store, setStore] = createStore({ messages: session(running) })
    let count = 0

    const rows = build(
      () => store.messages,
      () => {
        count++

        return { type: "busy" }
      },
    )

    const report = (metadata: { [key: string]: JsonValue }) =>
      setStore(
        produce((state) => {
          const message = state.messages[1]
          const tool = message?.type === "assistant" ? message.content[1] : undefined

          if (tool?.type === "tool" && tool.state.status === "running") tool.state.metadata = metadata
        }),
      )

    rows()
    const shell = { tool: "shell", status: "running", input: { command: "sleep 2" } }
    report({ toolCalls: [shell], background: true })
    rows()

    const first = count

    // Reports that only repeat what is known move nothing.
    for (let step = 0; step < 4; step++) {
      report({ toolCalls: [shell], background: true, step })
      rows()
    }

    const repeated = count - first
    // A call that starts adds its row; one that finishes settles its own.
    report({ toolCalls: [shell, shell], background: true })
    rows()
    const added = count - first - repeated
    report({ toolCalls: [{ ...shell, status: "completed" }, shell], background: true })
    rows()
    const settled = count - first - repeated - added
    dispose()

    return { repeated, added, settled }
  })
