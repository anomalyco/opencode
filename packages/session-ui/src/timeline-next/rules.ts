import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { currentToolInput } from "../message/current-tool-state"
import { toolName } from "../timeline/facts"
import type { TimelineDetail } from "../timeline/detail"
import { isInterruptedError } from "../timeline/turn-phase-machine"
import { Predicate } from "effect"

/**
 * How the New timeline shows a call or notice. Where each shows under the detail setting is `timeline/place`'s to say.
 * Whatever the setting, the timeline always shows your messages and the commands you ran, a turn you stopped, and what
 * changed the session (`sessionEvent`).
 */

type Content = SessionMessageAssistant["content"][number]

/** What the agent was doing with a call. It names the group the call folds into: Explored, Edited, Ran. */
export type ToolMode = "explore" | "edit" | "run" | "tool"

/**
 * How a call shows when it stands on its own:
 * - `line`: one line of activity, a command's included: commands run long, so its row cuts the command to a line.
 * - `file`: a file's name and changes, opening to its whole diff.
 * - `event`: a subagent task or a shell started in the background.
 */
export type ToolLayout = "line" | "file" | "event"

export type ToolRule = { mode: ToolMode; layout: ToolLayout }

const explore: ToolRule = { mode: "explore", layout: "line" }

const file: ToolRule = { mode: "edit", layout: "file" }

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
    shell: { mode: "run", layout: "line" },
    execute: { mode: "run", layout: "line" },
    subagent: { mode: "tool", layout: "event" },
    question: { mode: "tool", layout: "line" },
    todowrite: { mode: "tool", layout: "line" },
  } satisfies Record<string, ToolRule>),
)

const other: ToolRule = { mode: "tool", layout: "line" }

/** A call's rule, under the tool's current name. */
export function toolRule(tool: SessionMessageAssistantTool): ToolRule & { name: string } {
  const name = toolName(tool.name)
  const rule = tools.get(name) ?? other

  // A shell the agent started in the background reports back like a subagent.
  if (name === "shell" && currentToolInput(tool).background === true) return { ...rule, name, layout: "event" }

  return { ...rule, name }
}

/**
 * Whether the user stopped a call, by stopping the turn or cancelling its command. The shell reports a cancelled
 * command as its own error, "Command cancelled".
 */
export function toolStopped(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "error") return false

  return isInterruptedError(tool.state.error) || tool.state.error.message === "Command cancelled"
}

// A thought shows while it streams, before its first words arrive, so the timeline never hides that the model is
// thinking. Once finished, a thought without text has nothing to open.
export function textShows(content: Exclude<Content, { type: "tool" }>) {
  if (content.text.trim()) return true

  return content.type === "reasoning" && content.time?.completed === undefined
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

/** A move to where the session already is changes nothing, so it shows nothing. */
export function movedInPlace(message: SessionMessageInfo) {
  return message.type === "location-switched" && message.previous?.location.directory === message.location.directory
}

/** A goal the user set, which reads as their own message. */
export function goal(
  message: SessionMessageInfo | undefined,
): message is Extract<SessionMessageInfo, { type: "synthetic" }> {
  return message?.type === "synthetic" && message.metadata?.source === "goal"
}
