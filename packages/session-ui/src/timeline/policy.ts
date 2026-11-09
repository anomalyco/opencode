import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageShell } from "@opencode/client/promise"
import { canonicalToolName, currentToolFailed, shellResultFailed } from "../message/current-tool-state"
import type { TimelineDetail, TimelinePlacement } from "./detail"

type Content = SessionMessageAssistant["content"][number]

/**
 * Every rule that reads the timeline detail setting lives here: which category an item belongs to, whether it shows,
 * and whether it starts open. The projection and the row renderer ask these questions rather than reading the
 * setting themselves.
 */
export function timelineCategory(content: Content): keyof TimelineDetail | undefined {
  if (content.type === "text") return

  if (content.type === "reasoning") return "thinking"

  const name = canonicalToolName(content.name)

  if (name === "shell" || name === "execute") return "shell"

  if (name === "edit" || name === "write" || name === "patch") return "edit"

  if (name === "subagent") return "subagents"

  return "tools"
}

/**
 * Whether a part of an assistant message shows at all. A failed call shows even where its category is hidden, except
 * in the Activity timeline, where the agent's recovery is part of the work the setting hides.
 */
export function timelineRenders(detail: TimelineDetail, content: Content, activity = false) {
  if (content.type === "text") return timelineTextShows(content)

  if (content.type === "reasoning") return detail.thinking.placement !== "hidden" && timelineTextShows(content)

  if (!activity && currentToolFailed(content)) return true

  if (content.name === "todowrite") return false

  if (content.name === "question") return content.state.status !== "streaming" && content.state.status !== "running"

  return detail[timelineCategory(content)!].placement !== "hidden"
}

// A thought shows while it streams, before its first words arrive, so the timeline never hides that the model is
// thinking. Once finished, a thought without text has nothing to open.
export function timelineTextShows(content: Exclude<Content, { type: "tool" }>) {
  if (content.text.trim()) return true

  return content.type === "reasoning" && content.time?.completed === undefined
}

/**
 * Whether an item starts open. What the user opened or closed always wins over this. In the Activity timeline a shell
 * and a diff always show, cut to a few lines, so open means shown in full and they start cut.
 */
export function timelineDefaultOpen(detail: TimelineDetail, item: Content | SessionMessageShell, activity = false) {
  if (activity && timelineClamps(item)) return false

  // The user ran this command, so it opens to confirm it went through, whatever the setting.
  if (item.type === "shell") return true

  if (item.type === "tool" && item.name === "execute") return true

  const category = timelineCategory(item)

  if (!category) return false

  // A failure shows even where its category is hidden, open so it explains itself.
  if (detail[category].placement === "hidden" && item.type === "tool" && currentToolFailed(item)) return true

  if (category === "thinking") return timelineThinkingOpen(detail)

  if (category === "shell" || category === "edit") return detail[category].details === "expanded"

  return false
}

/** Whether the setting hides every kind of activity, as Messages only does. */
export function timelineHidesActivity(detail: TimelineDetail) {
  return (["shell", "edit", "thinking", "subagents", "tools"] as const).every(
    (category) => detail[category].placement === "hidden",
  )
}

/** Whether a thought starts open. */
export function timelineThinkingOpen(detail: TimelineDetail) {
  return detail.thinking.details === "expanded"
}

/** Whether a file's diff starts open where an edit shows its files. */
export function timelineDiffOpen(detail: TimelineDetail, activity = false) {
  return !activity && detail.edit.details === "expanded"
}

function timelineClamps(item: Content | SessionMessageShell) {
  if (item.type === "shell") return true

  // A call that errored shows as an error card, which keeps its own default. A command that exits non-zero still clamps.
  if (item.type !== "tool" || item.state.status === "error") return false
  const category = timelineCategory(item)

  return (category === "shell" && canonicalToolName(item.name) === "shell") || category === "edit"
}

// Like the TUI, background work reports its outcome as its own row where it finished, never folded into a group.
// A subagent's outcome follows the subagent setting, so it shows wherever its launch does.
export function timelineNoticePlacement(detail: TimelineDetail, message: SessionMessageInfo): TimelinePlacement {
  if (timelineEvent(message)) return "separate"
  const source = message.type === "synthetic" ? message.metadata?.source : undefined
  const placement = source === "subagent" ? detail.subagents.placement : detail.notices.placement

  if (placement === "hidden") return timelineNoticeRequired(message) ? "separate" : "hidden"

  return source === "subagent" || source === "shell" ? "separate" : placement
}

/**
 * What the user did and what changed the session: a goal, a switch of agent, model or place, and a compaction. These
 * always stand on their own, whatever the setting, so the timeline confirms them.
 */
export function timelineEvent(message: SessionMessageInfo) {
  if (
    message.type === "agent-switched" ||
    message.type === "model-switched" ||
    message.type === "location-switched" ||
    message.type === "compaction"
  )
    return true

  return message.type === "synthetic" && message.metadata?.source === "goal"
}

export function timelineNoticeRequired(message: SessionMessageInfo) {
  if (message.type === "compaction") return message.status !== "completed"

  if (message.type !== "synthetic") return false
  const metadata = message.metadata

  return (
    metadata?.state === "error" ||
    (metadata?.source === "shell" && metadata.state === "completed" && shellResultFailed(metadata))
  )
}

export function shellFailed(message: SessionMessageShell) {
  return (
    message.status === "timeout" || (message.status === "exited" && message.exit !== undefined && message.exit !== 0)
  )
}

/** What the agent was doing with a call: reading the codebase, changing files, running commands, or something else. */
export type TimelineMode = "explore" | "edit" | "run" | "tool"

export function timelineMode(tool: Extract<Content, { type: "tool" }>): TimelineMode {
  const name = canonicalToolName(tool.name)

  if (["read", "list", "glob", "grep", "webfetch", "websearch", "skill"].includes(name)) return "explore"

  if (name === "edit" || name === "write" || name === "patch") return "edit"

  if (name === "shell" || name === "execute") return "run"

  return "tool"
}
