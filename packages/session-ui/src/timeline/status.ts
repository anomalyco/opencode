import type { SessionMessageAssistant } from "@opencode/client/promise"
import { canonicalToolName } from "../message/current-tool-state"
import type { TimelineDetail } from "./detail"
import { timelineMode } from "./policy"

type Content = SessionMessageAssistant["content"][number]

export type TimelineStatus =
  | "waitingApproval"
  | "waitingAnswer"
  | "waitingCommand"
  | "waitingAgent"
  | "thinking"
  | "exploring"
  | "editing"
  | "running"
  | "working"

/**
 * The one word the status line below a working turn says: the first that applies of what blocks on the user, what the
 * agent waits on, then what it is doing. Settings that hide the agent's activity keep it to "Working" unless the user
 * has to act.
 */
export function timelineStatus(input: {
  detail: TimelineDetail
  /** A permission or a question waits on the user. */
  blocked?: "approval" | "answer"
  /** The active step's content, oldest first. */
  content: readonly Content[]
}): TimelineStatus {
  if (input.blocked === "approval") return "waitingApproval"

  if (input.blocked === "answer") return "waitingAnswer"
  const last = input.content.at(-1)

  if (last?.type === "tool" && (last.state.status === "running" || last.state.status === "streaming")) {
    const name = canonicalToolName(last.name)

    if (name === "shell") return "waitingCommand"

    if (name === "subagent") return "waitingAgent"
  }

  if (input.detail.tools.placement === "hidden") return "working"

  if (last?.type === "reasoning" && last.time?.completed === undefined) return "thinking"

  const tool = input.content.findLast((item) => item.type === "tool")

  if (!tool || last?.type === "text") return "working"

  return (
    { explore: "exploring", edit: "editing", run: "running", tool: "working" } as const satisfies Record<
      ReturnType<typeof timelineMode>,
      TimelineStatus
    >
  )[timelineMode(tool)]
}
