import type { SessionMessageAssistant } from "@opencode/client/promise"
import type { TimelineDetail } from "../timeline/detail"
import { liveThinkingShows, toolRule } from "./rules"

type Content = SessionMessageAssistant["content"][number]

export type TimelineStatus = "waitingApproval" | "waitingAnswer" | "waitingShell" | "working"

/**
 * The status line says Working unless the turn is waiting on the user or a shell command.
 */
export function timelineStatus(input: {
  /** A permission or a question waits on the user. */
  blocked?: "approval" | "answer"
  /** The active step's content, oldest first. */
  content: readonly Content[]
}): TimelineStatus {
  if (input.blocked === "approval") return "waitingApproval"

  if (input.blocked === "answer") return "waitingAnswer"
  const last = input.content.at(-1)

  if (last?.type !== "tool" || (last.state.status !== "running" && last.state.status !== "streaming")) return "working"

  return toolRule(last).name === "shell" ? "waitingShell" : "working"
}

/** Whether the model is writing a thought that shows, which then stands in for the status line's Working. */
export function timelineThinking(detail: TimelineDetail, content: readonly Content[]) {
  const last = content.at(-1)

  return liveThinkingShows(detail) && last?.type === "reasoning" && last.time?.completed === undefined
}
