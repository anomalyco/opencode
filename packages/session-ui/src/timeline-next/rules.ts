import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { currentToolFailed, currentToolGroupedRead, currentToolInput } from "../message/current-tool-state"
import { timelineNoticeRequired, type TimelineDetail, type TimelinePlacement } from "../timeline/detail"

/**
 * What the New timeline shows, where, and how. The projection and the rows ask these questions; nothing else reads the
 * detail setting. Whatever the setting, the timeline always shows your messages and the commands you ran, a turn you
 * stopped, and what changed the session (`sessionEvent`).
 */

type Content = SessionMessageAssistant["content"][number]

/** What the agent was doing with a call. It names the group the call folds into: Explored, Edited, Ran. */
export type ToolMode = "explore" | "edit" | "run" | "tool"

/**
 * How a call shows when it stands on its own:
 * - `line`: one line of activity.
 * - `card`: a command and its output, cut to its first lines until opened.
 * - `file`: a file's changes, cut to the first lines of its diff until opened.
 * - `event`: work that runs on, counted with others like it: Started 2 subagents.
 */
export type ToolShape = "line" | "card" | "file" | "event"

export type ToolRule = {
  /** The detail setting that shows or hides it. */
  category: "shell" | "edit" | "subagents" | "tools"
  mode: ToolMode
  shape: ToolShape
  /** Starts open, whatever the setting. */
  open?: boolean
  /** Shows only once settled, and never folds into a group. */
  alone?: boolean
  /** Never shows. */
  hidden?: boolean
}

const explore: ToolRule = { category: "tools", mode: "explore", shape: "line" }
const file: ToolRule = { category: "edit", mode: "edit", shape: "file" }

/** Every tool the timeline knows, by its current name. Any other tool is a line of activity under Tools. */
const tools: Record<string, ToolRule> = {
  read: explore,
  list: explore,
  glob: explore,
  grep: explore,
  webfetch: explore,
  websearch: explore,
  skill: explore,
  edit: file,
  write: file,
  patch: file,
  shell: { category: "shell", mode: "run", shape: "card" },
  execute: { category: "shell", mode: "run", shape: "line", open: true },
  subagent: { category: "subagents", mode: "tool", shape: "event" },
  question: { category: "tools", mode: "tool", shape: "line", alone: true },
  todowrite: { category: "tools", mode: "tool", shape: "line", hidden: true },
}

const other: ToolRule = { category: "tools", mode: "tool", shape: "line" }

// Sessions migrated from v1 keep the tools' old names.
const renamed: Record<string, string | undefined> = { bash: "shell", task: "subagent", apply_patch: "patch" }

/** A call's rule, under the tool's current name. */
export function toolRule(tool: SessionMessageAssistantTool): ToolRule & { name: string } {
  const name = renamed[tool.name] ?? tool.name
  const rule = tools[name] ?? other

  // A shell the agent started in the background reports back like a subagent.
  if (name === "shell" && currentToolInput(tool).background === true) return { ...rule, name, shape: "event" }

  return { ...rule, name }
}

/** Whether a call failed: it errored, or the command it ran exited non-zero. */
export function toolFailed(tool: SessionMessageAssistantTool) {
  return currentToolFailed({ ...tool, name: toolRule(tool).name })
}

/** Whether a part of an assistant message shows. A failure shows only where its category does. */
export function contentShows(detail: TimelineDetail, content: Content) {
  if (content.type === "text") return textShows(content)

  if (content.type === "reasoning") return detail.thinking.placement !== "hidden" && textShows(content)
  const rule = toolRule(content)

  if (rule.hidden) return false

  if (rule.alone) return content.state.status !== "streaming" && content.state.status !== "running"

  return detail[rule.category].placement !== "hidden"
}

// A thought shows while it streams, before its first words arrive, so the timeline never hides that the model is
// thinking. Once finished, a thought without text has nothing to open.
export function textShows(content: Exclude<Content, { type: "tool" }>) {
  if (content.text.trim()) return true

  return content.type === "reasoning" && content.time?.completed === undefined
}

/**
 * The group a part folds into with its neighbours, or none when it stands on its own:
 * - `events`: subagents and background shells, counted in one row.
 * - `context`: the activity group, where the part's category is grouped.
 * - `read`: files read one after another, where reads stand on their own.
 * - `file`: a file's changes, as a card.
 */
export function contentGroup(detail: TimelineDetail, content: Content, commentary: ReadonlySet<Content>) {
  if (content.type === "text") return commentary.has(content) ? ("context" as const) : undefined

  if (content.type === "reasoning") return detail.thinking.placement === "grouped" ? ("context" as const) : undefined
  const rule = toolRule(content)

  if (rule.shape === "event") return "events" as const

  if (rule.alone && !toolFailed(content)) return undefined

  if (detail[rule.category].placement === "grouped") return "context" as const

  if (currentToolGroupedRead(content)) return "read" as const

  if (toolFailed(content)) return undefined

  return rule.shape === "file" ? ("file" as const) : undefined
}

/**
 * Whether a part starts open. What the user opened or closed always wins. A card or a file shows its first lines
 * whatever the setting, so open means shown in full and they start cut short; a call that errored keeps the error
 * card's own default.
 */
export function contentOpens(detail: TimelineDetail, content: Content) {
  if (content.type === "text") return false

  if (content.type === "reasoning") return thinkingOpens(detail)
  const rule = toolRule(content)

  if (content.state.status !== "error" && (rule.shape === "card" || rule.shape === "file")) return false

  if (rule.open) return true

  if (rule.category === "shell" || rule.category === "edit") return detail[rule.category].details === "expanded"

  return false
}

/** Whether a thought starts open. */
export function thinkingOpens(detail: TimelineDetail) {
  return detail.thinking.details === "expanded"
}

/** Whether a thought the model is writing shows, at the end of its turn, in place of the status line. */
export function liveThinkingShows(detail: TimelineDetail) {
  return detail.thinking.placement !== "hidden"
}

/** A command the user ran always shows, cut to its first lines. */
export const userShellOpens = false

/**
 * Where a notice shows. What the user did and what changed the session always stands on its own. Background work
 * reports its outcome as its own row; a subagent's follows the subagent setting, so it shows wherever its launch did.
 */
export function noticePlacement(detail: TimelineDetail, message: SessionMessageInfo): TimelinePlacement {
  if (sessionEvent(message)) return "separate"
  const source = message.type === "synthetic" ? message.metadata?.source : undefined
  const placement = source === "subagent" ? detail.subagents.placement : detail.notices.placement

  if (placement === "hidden") return timelineNoticeRequired(message) ? "separate" : "hidden"

  return source === "subagent" || source === "shell" ? "separate" : placement
}

/** What the user did and what changed the session: a goal, a switch of agent, model or place, and a compaction. */
export function sessionEvent(message: SessionMessageInfo) {
  if (
    message.type === "agent-switched" ||
    message.type === "model-switched" ||
    message.type === "location-switched" ||
    message.type === "compaction"
  )
    return true

  return goal(message)
}

/** A goal the user set, which reads as their own message. */
export function goal(message: SessionMessageInfo | undefined) {
  return message?.type === "synthetic" && message.metadata?.source === "goal"
}

/** Whether the setting hides all of the agent's activity, as Messages only does. A stopped turn then says how long it worked. */
export function hidesActivity(detail: TimelineDetail) {
  return (["shell", "edit", "thinking", "subagents", "tools"] as const).every(
    (category) => detail[category].placement === "hidden",
  )
}
