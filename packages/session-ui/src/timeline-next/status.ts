import type { SessionMessageAssistant } from "@opencode/client/promise"
import type { TimelineDetail } from "../timeline/detail"
import { liveThinkingShows, toolRule } from "./rules"

type Content = SessionMessageAssistant["content"][number]

export type TimelineStatus =
  | "waitingApproval"
  | "waitingAnswer"
  | "waitingShell"
  | "waitingAgent"
  | "waitingAgents"
  | "working"

/**
 * What the status line below a working turn says. It names what the turn waits on, the user or a command or subagent
 * it started, and otherwise says Working: what the agent does shows in the timeline above it.
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
  const name = toolRule(last).name

  if (name === "shell") return "waitingShell"

  if (name !== "subagent") return "working"

  // Subagents started together run side by side, so the line counts every one still running.
  const running = input.content.filter(
    (item) =>
      item.type === "tool" &&
      toolRule(item).name === "subagent" &&
      (item.state.status === "running" || item.state.status === "streaming"),
  )

  return running.length > 1 ? "waitingAgents" : "waitingAgent"
}

/** Whether the model is writing a thought that shows, which then stands in for the status line's Working. */
export function timelineThinking(detail: TimelineDetail, content: readonly Content[]) {
  const last = content.at(-1)

  return liveThinkingShows(detail) && last?.type === "reasoning" && last.time?.completed === undefined
}
