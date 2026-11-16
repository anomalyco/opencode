import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { currentToolInput, currentToolMetadata } from "../message/current-tool-state"
import { toolRule } from "./rules"

export type TimelineEventKind = "subagent" | "shell"

export type TimelineEventVerb = "started" | "ran" | "finished" | "stopped"

export type TimelineEvent = {
  verb: TimelineEventVerb | "updated"
  kind: TimelineEventKind
  failed: boolean
  /** What opening the row lists: a subagent's task or a shell's command, and where each leads. */
  title?: string
  agent?: string
  sessionID?: string
  shellID?: string
}

/** Status labels shared by task rows and shell summaries. */
export const verbKeys = {
  started: "ui.timeline.event.started",
  ran: "ui.timeline.activity.ran",
  finished: "ui.timeline.event.finished",
  stopped: "ui.timeline.event.stopped",
} as const

/** How a group's label counts work that runs on, beside its other calls: "1 command, started 1 shell". */
export const launchKeys = {
  started: "ui.timeline.activity.startedShells",
  ran: "ui.timeline.activity.commands",
  finished: "ui.timeline.activity.finishedShells",
  stopped: "ui.timeline.activity.stoppedShells",
} as const

// Text a call or notice carries, where it is not empty.
const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString)

/**
 * What a call says happened. A call still being written has nothing to count yet. Older sessions marked a
 * foreground subagent's result as completed; current subagent calls only launch the work.
 */
export function toolEvent(tool: SessionMessageAssistantTool): TimelineEvent | undefined {
  const kind = toolRule(tool).name === "shell" ? "shell" : "subagent"
  const state = tool.state

  if (state.status === "streaming") return undefined
  const input = currentToolInput(tool)
  const metadata = currentToolMetadata(tool)
  const followUp = kind === "subagent" ? Option.getOrUndefined(decodeText(input.sessionID)) : undefined

  const item = {
    kind,
    title: Option.getOrUndefined(decodeText(kind === "shell" ? input.command : input.description)),
    agent: kind === "subagent" ? Option.getOrUndefined(decodeText(input.agent ?? input.subagent_type)) : undefined,
    sessionID: kind === "subagent" ? (Option.getOrUndefined(decodeText(metadata.sessionID)) ?? followUp) : undefined,
    shellID: kind === "shell" ? Option.getOrUndefined(decodeText(metadata.shellID)) : undefined,
  } as const

  if (state.status === "running") return { ...item, verb: followUp ? "updated" : "started", failed: false }

  const background =
    kind === "subagent" ? metadata.status !== "completed" : metadata.status === "running" || input.background === true

  if (state.status === "error") {
    if (state.error.type === "aborted") return { ...item, verb: "stopped", failed: false }

    return { ...item, verb: background ? "started" : "ran", failed: true }
  }

  if (followUp) return { ...item, verb: "updated", failed: false }

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

/** Which subagent or shell an event is about, where it says. */
export function workKey(event: TimelineEvent) {
  const id = event.kind === "shell" ? event.shellID : event.sessionID

  return id ? `${event.kind}:${id}` : undefined
}

/** Count background shells by verb in the order they happened. Subagents have individual task rows. */
export function summarizeShells(events: readonly TimelineEvent[]) {
  const counts = new Map<TimelineEventVerb, number>()
  const shells = events.filter((event) => event.kind === "shell")
  shells.forEach(({ verb }) => {
    if (verb !== "updated") counts.set(verb, (counts.get(verb) ?? 0) + 1)
  })

  return {
    verbs: Array.from(counts, ([verb, count]) => ({ verb, count })),
    failed: shells.filter((event) => event.failed).length,
  }
}
