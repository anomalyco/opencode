import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { untrack } from "solid-js"
import { timelineNoticeRequired, type TimelineDetail, type TimelinePlacement } from "./detail"
import { placeFactOf, scriptChangePaths, scriptFilePartID, type Fact, type PlaceFact } from "./facts"

/**
 * Where each fact shows, under the Timeline detail setting: its category, whether it stands alone, joins a group or
 * hides, and whether it starts open. The two timelines place a few things differently; `timeline` says which asks.
 */

type Content = SessionMessageAssistant["content"][number]

type Tool = Extract<Content, { type: "tool" }>

/** What can be placed: a call, a thought or text. Files and outcomes show through the call or notice they belong to. */
export type Placeable = PlaceFact | { kind: "thought"; id?: string } | { kind: "text"; id?: string }

/** Reads what placing a call needs. The projections read it through a signal, so a streamed delta moves nothing. */
export type PlaceFactOf = (tool: Tool) => PlaceFact

export type TimelineKind = "current" | "next"

/** The group a fact folds into, or `part` where it stands on its own row. */
export type PlaceGroup = "part" | "context" | "read" | "file" | "events" | "subagent"

export type Place = {
  category?: keyof TimelineDetail
  placement: TimelinePlacement
  group: PlaceGroup
  /** Whether it starts open, where the setting says; undefined leaves it to the row. */
  opens?: boolean
}

/** The detail setting that shows or hides a fact. */
export function categoryOf(fact: Fact | Placeable): keyof TimelineDetail | undefined {
  if (fact.kind === "thought") return "thinking"

  if (fact.kind === "file") return "edit"

  if (fact.kind === "outcome") return "notices"

  if (fact.kind !== "call") return

  if (fact.name === "shell" || fact.name === "execute") return "shell"

  if (fact.mode === "edit") return "edit"

  if (fact.name === "subagent") return "subagents"

  return "tools"
}

/** Places each fact, in order. `commentary` marks, by index, the text that reads as commentary between calls. */
export function place(
  facts: readonly Placeable[],
  detail: TimelineDetail,
  options: { timeline: TimelineKind; commentary?: readonly boolean[] },
): Place[] {
  return facts.map((fact, index) => placeFact(fact, detail, options.timeline, !!options.commentary?.[index]))
}

/** Places one message part. */
export function placeContent(
  content: Content,
  detail: TimelineDetail,
  timeline: TimelineKind,
  commentary = false,
  factOf: PlaceFactOf = placeFactOf,
) {
  return placeFact(placeableOf(content, factOf), detail, timeline, commentary)
}

/** Places message parts for one build of the rows, each call once however often it is asked. */
export function placer(detail: TimelineDetail, timeline: TimelineKind, factOf: PlaceFactOf = placeFactOf) {
  const placed = new Map<Content, Place>()

  return (content: Content, commentary = false) => {
    if (content.type !== "tool") return placeContent(content, detail, timeline, commentary)
    const known = placed.get(content)

    if (known) return known
    const result = placeContent(content, detail, timeline, false, factOf)
    placed.set(content, result)

    return result
  }
}

/** Where a change a script made to a file shows: under the Edits setting, as a direct edit's file does. */
export function placeScriptChange(detail: TimelineDetail): Place {
  const placement = detail.edit.placement

  return {
    category: "edit",
    placement,
    group: placement === "grouped" ? "context" : "file",
    opens: detail.edit.details === "expanded",
  }
}

/**
 * The changes a finished script made, as items of their own right after it, where edits show. Placement learns the
 * script finished with changes through `factOf`, so a running script's progress never rebuilds the rows.
 */
export function scriptChangeItems(
  messageID: string,
  messageIndex: number,
  content: Content,
  detail?: TimelineDetail,
  factOf: PlaceFactOf = placeFactOf,
) {
  if (!detail || detail.edit.placement === "hidden" || content.type !== "tool" || content.name !== "execute") return []

  if (factOf(content).changes === 0) return []

  // Changes only append, so their count says when the paths change and a progress report that adds none moves nothing.
  return untrack(() => scriptChangePaths(content)).map((path, index) => ({
    messageID,
    messageIndex,
    partID: scriptFilePartID(content.id, index, path),
    content,
    script: true as const,
  }))
}

function placeableOf(content: Content, factOf: PlaceFactOf): Placeable {
  if (content.type === "tool") return factOf(content)

  return { kind: content.type === "reasoning" ? "thought" : "text" }
}

function placeFact(fact: Placeable, detail: TimelineDetail, timeline: TimelineKind, commentary: boolean): Place {
  const category = categoryOf(fact)

  if (fact.kind === "text") {
    if (!commentary) return { placement: "separate", group: "part", opens: timeline === "next" ? false : undefined }
    const placement = detail.commentary.placement

    return {
      category: "commentary",
      placement,
      group: placement === "separate" ? "part" : "context",
      opens: timeline === "next" ? false : undefined,
    }
  }

  if (fact.kind === "thought") {
    const placement = detail.thinking.placement
    const opens = timeline === "next" ? false : detail.thinking.details === "expanded"

    return { category, placement, group: placement === "grouped" ? "context" : "part", opens }
  }

  if (!category) return { category, placement: "hidden", group: "part" }

  const setting = detail[category].placement
  const settled = fact.status !== "streaming" && fact.status !== "running"

  if (timeline === "current") {
    // The current timeline reads a call's own name, so v1 commands and patches keep their old rows.
    const failed = fact.status === "error" || (fact.failed && fact.tool !== "bash")
    const shows = failed || (fact.tool !== "todowrite" && (fact.tool === "question" ? settled : setting !== "hidden"))

    const group: PlaceGroup =
      fact.tool === "question" && !failed
        ? "part"
        : setting === "grouped"
          ? "context"
          : fact.groupedRead
            ? "read"
            : failed
              ? "part"
              : ["patch", "edit", "write"].includes(fact.tool)
                ? "file"
                : "part"

    const opens =
      fact.tool === "execute" || (setting === "hidden" && failed)
        ? true
        : category === "shell" || category === "edit"
          ? detail[category].details === "expanded"
          : fact.status === "error"
            ? false
            : undefined

    return { category, placement: shows ? (group === "context" ? "grouped" : "separate") : "hidden", group, opens }
  }

  // A call stopped before the model finished writing it did nothing.
  const shows =
    fact.name !== "todowrite" &&
    !(fact.stopped && !fact.called) &&
    (fact.name === "question" ? settled : setting !== "hidden")

  const group: PlaceGroup =
    category === "subagents"
      ? "subagent"
      : fact.background
        ? setting === "grouped" && !fact.failed
          ? "context"
          : "events"
        : fact.name === "question" && !fact.failed
          ? "part"
          : setting === "grouped"
            ? "context"
            : fact.groupedRead
              ? "read"
              : fact.failed
                ? "part"
                : fact.mode === "edit"
                  ? "file"
                  : "part"

  // A file shows its name and changes, closed; a stopped call shows as one that ran, so it opens as one would.
  const opens =
    fact.mode === "edit" && (fact.status !== "error" || fact.stopped)
      ? false
      : category === "shell" || category === "edit"
        ? detail[category].details === "expanded"
        : false

  return { category, placement: shows ? (group === "context" ? "grouped" : "separate") : "hidden", group, opens }
}

/** Whether a file's diff starts open, where edits show in detail. */
export function diffOpens(detail: TimelineDetail) {
  return detail.edit.details === "expanded"
}

/** Whether the setting hides all of the agent's activity, as Messages only does. */
export function hidesActivity(detail: TimelineDetail) {
  return (["shell", "edit", "thinking", "subagents", "tools"] as const).every(
    (category) => detail[category].placement === "hidden",
  )
}

/**
 * Where a notice shows. What background work reports stands on its own, so it shows where it finished. Where its
 * setting hides it, a notice that needs attention still shows. In the New timeline, a shell's report follows the shell
 * setting, and what changed the session always stands on its own.
 */
export function placeNotice(
  message: SessionMessageInfo,
  detail: TimelineDetail,
  timeline: TimelineKind,
): TimelinePlacement {
  if (timeline === "next" && sessionEvent(message)) return "separate"
  const source = message.type === "synthetic" ? message.metadata?.source : undefined

  const placement =
    source === "subagent"
      ? detail.subagents.placement
      : source === "shell" && timeline === "next"
        ? detail.shell.placement
        : detail.notices.placement

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
