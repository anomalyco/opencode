import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { currentToolFailed, currentToolGroupedRead, currentToolInput } from "../message/current-tool-state"
import { timelineNoticeRequired, type TimelineDetail, type TimelinePlacement } from "../timeline/detail"
import { isInterruptedError } from "../timeline/turn-phase-machine"
import { Predicate } from "effect"

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
 * - `line`: one line of activity, a command's included: commands run long, so its row cuts the command to a line.
 * - `file`: a file's name and changes, opening to its whole diff.
 * - `event`: work that runs on: a subagent, or a shell started in the background. Grouped, starting it is counted in
 *   the group's label; on its own, it is counted with others like it: Started 2 subagents.
 */
export type ToolLayout = "line" | "file" | "event"

export type ToolRule = {
  /** The detail setting that shows or hides it. */
  category: "shell" | "edit" | "subagents" | "tools"
  mode: ToolMode
  layout: ToolLayout
  /** Shows only once settled, and never folds into a group. */
  alone?: boolean
  /** Never shows. */
  hidden?: boolean
}

const explore: ToolRule = { category: "tools", mode: "explore", layout: "line" }

const file: ToolRule = { category: "edit", mode: "edit", layout: "file" }

/** Every tool the timeline knows, by its current name. Any other tool is a line of activity under Tools. */
const tools = new Map<string, ToolRule>(
  Object.entries({
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
    shell: { category: "shell", mode: "run", layout: "line" },
    execute: { category: "shell", mode: "run", layout: "line" },
    subagent: { category: "subagents", mode: "tool", layout: "event" },
    question: { category: "tools", mode: "tool", layout: "line", alone: true },
    todowrite: { category: "tools", mode: "tool", layout: "line", hidden: true },
  } satisfies Record<string, ToolRule>),
)

const other: ToolRule = { category: "tools", mode: "tool", layout: "line" }

// Sessions migrated from v1 keep the tools' old names.
const renamed = new Map([
  ["bash", "shell"],
  ["task", "subagent"],
  ["apply_patch", "patch"],
])

/** A call's rule, under the tool's current name. */
export function toolRule(tool: SessionMessageAssistantTool): ToolRule & { name: string } {
  const name = renamed.get(tool.name) ?? tool.name
  const rule = tools.get(name) ?? other

  // A shell the agent started in the background reports back like a subagent.
  if (name === "shell" && currentToolInput(tool).background === true) return { ...rule, name, layout: "event" }

  return { ...rule, name }
}

/** Whether a call failed: it errored, or the command it ran exited non-zero. A call the user stopped did not fail. */
export function toolFailed(tool: SessionMessageAssistantTool) {
  return !toolStopped(tool) && currentToolFailed({ ...tool, name: toolRule(tool).name })
}

/**
 * Whether the user stopped a call, by stopping the turn or cancelling its command. The shell reports a cancelled
 * command as its own error, "Command cancelled".
 */
export function toolStopped(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "error") return false

  return isInterruptedError(tool.state.error) || tool.state.error.message === "Command cancelled"
}

/** Whether a part of an assistant message shows. A failure shows only where its category does. */
export function contentShows(detail: TimelineDetail, content: Content) {
  if (content.type === "text") return textShows(content)

  if (content.type === "reasoning") return detail.thinking.placement !== "hidden" && textShows(content)
  const rule = toolRule(content)

  if (rule.hidden) return false

  // A call stopped before the model finished writing it did nothing.
  if (toolStopped(content) && Object.keys(currentToolInput(content)).length === 0) return false

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

  // Starting work that runs on is an action like any other, so it joins the activity group where its setting groups
  // it. A launch that failed keeps its own row, as failures do.
  if (rule.layout === "event")
    return detail[rule.category].placement === "grouped" && !toolFailed(content)
      ? ("context" as const)
      : ("events" as const)

  if (rule.alone && !toolFailed(content)) return undefined

  if (detail[rule.category].placement === "grouped") return "context" as const

  if (currentToolGroupedRead(content)) return "read" as const

  if (toolFailed(content)) return undefined

  return rule.layout === "file" ? ("file" as const) : undefined
}

/**
 * Whether a part starts open. What the user opened or closed always wins. Expanded details show a command with its
 * output and a call's details; collapsed ones show each as one line. A file shows its name
 * and changes, its diff opening as `diffOpens` says, and a call that errored opens to its error where details expand.
 */
export function contentOpens(detail: TimelineDetail, content: Content) {
  if (content.type === "text") return false

  if (content.type === "reasoning") return thoughtOpens(detail, false)
  const rule = toolRule(content)

  // A stopped call shows as one that ran, so it opens as one would.
  if (rule.layout === "file" && (content.state.status !== "error" || toolStopped(content))) return false

  if (rule.category === "shell" || rule.category === "edit") return detail[rule.category].details === "expanded"

  return false
}

/** Whether a file's diff starts open, where edits show in detail. */
export function diffOpens(detail: TimelineDetail) {
  return detail.edit.details === "expanded"
}

/**
 * Whether a thought starts open. Expanded details stream the thought the model is writing in view and close it once
 * it is finished, when the next step follows; collapsed ones keep it to one line throughout. Opening it shows the
 * thought.
 */
export function thoughtOpens(detail: TimelineDetail, streaming: boolean) {
  return streaming && detail.thinking.details === "expanded"
}

/** Whether a thought the model is writing shows, at the end of its turn, in place of the status line. */
export function liveThinkingShows(detail: TimelineDetail) {
  return detail.thinking.placement !== "hidden"
}

/** A command the user ran always shows, whole where shell details expand and its last lines otherwise. */
export function userShellOpens(detail: TimelineDetail) {
  return detail.shell.details === "expanded"
}

/** The notice the agent gets about a command the user ran repeats that command's own card, so it never shows. */
export function echoesUserShell(message: SessionMessageInfo, userShellIDs: ReadonlySet<string>) {
  const shellID = message.type === "synthetic" ? message.metadata?.shellID : undefined

  return (
    message.type === "synthetic" &&
    message.metadata?.source === "shell" &&
    Predicate.isString(shellID) &&
    userShellIDs.has(shellID)
  )
}

/**
 * Where a notice shows. What the user did and what changed the session always stands on its own. Background work
 * reports its outcome as an event, following the setting its launch follows: a subagent's the subagent setting, a
 * shell's the shell setting.
 */
export function noticePlacement(detail: TimelineDetail, message: SessionMessageInfo): TimelinePlacement {
  if (sessionEvent(message)) return "separate"
  const source = message.type === "synthetic" ? message.metadata?.source : undefined

  const background = { subagent: detail.subagents.placement, shell: detail.shell.placement }
  const placement = source === "subagent" || source === "shell" ? background[source] : detail.notices.placement

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
export function goal(
  message: SessionMessageInfo | undefined,
): message is Extract<SessionMessageInfo, { type: "synthetic" }> {
  return message?.type === "synthetic" && message.metadata?.source === "goal"
}

/** Whether the setting hides all of the agent's activity, as Messages only does. A stopped turn then says how long it worked. */
export function hidesActivity(detail: TimelineDetail) {
  return (["shell", "edit", "thinking", "subagents", "tools"] as const).every(
    (category) => detail[category].placement === "hidden",
  )
}
