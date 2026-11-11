import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { currentToolInput, currentToolMetadata } from "../message/current-tool-state"
import { toolRule } from "./rules"

/**
 * Subagents and background shells read as events rather than tool rows: started, ran, finished and stopped, counted by
 * kind. Titles and commands stay in the background panel above the composer.
 */
export type TimelineEventKind = "subagent" | "shell"

export type TimelineEventVerb = "started" | "ran" | "finished" | "stopped"

export type TimelineEvent = {
  verb: TimelineEventVerb
  kind: TimelineEventKind
  failed: boolean
  /** What opening the row lists: a subagent's task or a shell's command, and where each leads. */
  title?: string
  agent?: string
  sessionID?: string
  shellID?: string
}

/** How an events row names each verb and kind: "Started 2 subagents". */
export const verbKeys = {
  started: "ui.timeline.event.started",
  ran: "ui.timeline.activity.ran",
  finished: "ui.timeline.event.finished",
  stopped: "ui.timeline.event.stopped",
} as const

export const kindKeys = {
  subagent: "ui.timeline.event.subagents",
  shell: "ui.timeline.event.shells",
} as const

/** How a group's label counts work it started, beside its other calls: "1 command, started 1 shell". */
export const launchKeys = {
  started: { shell: "ui.timeline.activity.startedShells", subagent: "ui.timeline.activity.startedSubagents" },
  ran: { shell: "ui.timeline.activity.commands", subagent: "ui.timeline.activity.subagents" },
} as const

// Text a call or notice carries, where it is not empty.
const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString)

/**
 * What a call says happened. A call still being written has nothing to count yet. A subagent that returns while it
 * keeps running was started in the background; one that returned with its work done ran in the foreground.
 */
export function toolEvent(tool: SessionMessageAssistantTool): TimelineEvent | undefined {
  const kind = toolRule(tool).name === "shell" ? "shell" : "subagent"
  const state = tool.state

  if (state.status === "streaming") return undefined
  const input = currentToolInput(tool)
  const metadata = currentToolMetadata(tool)

  const item = {
    kind,
    title: Option.getOrUndefined(decodeText(kind === "shell" ? input.command : input.description)),
    agent: kind === "subagent" ? Option.getOrUndefined(decodeText(input.agent)) : undefined,
    sessionID: kind === "subagent" ? Option.getOrUndefined(decodeText(metadata.sessionID)) : undefined,
    shellID: kind === "shell" ? Option.getOrUndefined(decodeText(metadata.shellID)) : undefined,
  } as const

  if (state.status === "running") return { ...item, verb: "started", failed: false }

  const background = metadata.status === "running" || input.background === true

  if (state.status === "error") {
    // An interrupted turn stops the work it was waiting on.
    if (state.error.type === "aborted") return { ...item, verb: "stopped", failed: false }

    return { ...item, verb: background ? "started" : "ran", failed: true }
  }

  return { ...item, verb: background ? "started" : "ran", failed: false }
}

/** The outcome a background subagent or shell reports when it finishes. */
export function noticeEvent(message: SessionMessageInfo): TimelineEvent | undefined {
  if (message.type !== "synthetic") return undefined
  const source = message.metadata?.source

  if (source !== "subagent" && source !== "shell") return undefined
  const state = message.metadata?.state

  const item = {
    kind: source,
    title: Option.getOrUndefined(decodeText(message.description)),
    agent: Option.getOrUndefined(decodeText(message.metadata?.agent)),
    sessionID: Option.getOrUndefined(decodeText(message.metadata?.childID)),
    shellID: Option.getOrUndefined(decodeText(message.metadata?.shellID)),
  } as const

  if (state === "cancelled") return { ...item, verb: "stopped", failed: false }

  return { ...item, verb: "finished", failed: state === "error" }
}

/**
 * A run of events as one label: each verb once, in the order it first happened, with how many of each kind, and how
 * many failed overall. Two finishes in a row read "Finished 2 subagents".
 */
export function summarizeEvents(events: readonly TimelineEvent[]) {
  const verbs = events.reduce<{ verb: TimelineEventVerb; kinds: { kind: TimelineEventKind; count: number }[] }[]>(
    (result, event) => {
      const bucket = result.find((item) => item.verb === event.verb) ?? { verb: event.verb, kinds: [] }

      if (!result.includes(bucket)) result.push(bucket)
      const kind = bucket.kinds.find((item) => item.kind === event.kind)

      if (kind) kind.count += 1

      if (!kind) bucket.kinds.push({ kind: event.kind, count: 1 })

      return result
    },
    [],
  )

  return { verbs, failed: events.filter((event) => event.failed).length }
}
