import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageShell } from "@opencode/client/promise"
import { currentToolFailed, shellResultFailed } from "../message/current-tool-state"
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

  if (["shell", "execute", "bash"].includes(content.name)) return "shell"

  if (["edit", "write", "patch", "apply_patch"].includes(content.name)) return "edit"

  if (["subagent", "task"].includes(content.name)) return "subagents"

  return "tools"
}

/** Whether a part of an assistant message shows at all. */
export function timelineRenders(detail: TimelineDetail, content: Content) {
  if (content.type === "text") return !!content.text.trim()

  if (content.type === "reasoning") return detail.thinking.placement !== "hidden" && !!content.text.trim()

  if (currentToolFailed(content)) return true

  if (content.name === "todowrite") return false

  if (content.name === "question") return content.state.status !== "streaming" && content.state.status !== "running"

  return detail[timelineCategory(content)!].placement !== "hidden"
}

/** Whether an item starts open. What the user opened or closed always wins over this. */
export function timelineDefaultOpen(detail: TimelineDetail, item: Content | SessionMessageShell) {
  if (item.type === "shell")
    return detail.shell.details === "expanded" || (detail.shell.placement === "hidden" && shellFailed(item))

  if (item.type === "tool" && item.name === "execute") return true

  const category = timelineCategory(item)

  if (!category) return false

  // A failure shows even where its category is hidden, open so it explains itself.
  if (detail[category].placement === "hidden" && item.type === "tool" && currentToolFailed(item)) return true

  if (category === "thinking") return timelineThinkingOpen(detail)

  if (category === "shell" || category === "edit") return detail[category].details === "expanded"

  return false
}

/** Whether a thought starts open. */
export function timelineThinkingOpen(detail: TimelineDetail) {
  return detail.thinking.details === "expanded"
}

/** Whether a file's diff starts open where an edit shows its files. */
export function timelineDiffOpen(detail: TimelineDetail) {
  return detail.edit.details === "expanded"
}

// Like the TUI, background work reports its outcome as its own row where it finished, never folded into a group.
// A subagent's outcome follows the subagent setting, so it shows wherever its launch does.
export function timelineNoticePlacement(detail: TimelineDetail, message: SessionMessageInfo): TimelinePlacement {
  const source = message.type === "synthetic" ? message.metadata?.source : undefined
  const placement = source === "subagent" ? detail.subagents.placement : detail.notices.placement

  if (placement === "hidden") return timelineNoticeRequired(message) ? "separate" : "hidden"

  return source === "subagent" || source === "shell" ? "separate" : placement
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
