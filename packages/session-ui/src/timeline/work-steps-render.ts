import type { SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { currentToolInput } from "../message/current-tool-state"
import type { ContextGroupPart } from "../tools/tool-renderer"
import { timelineCategory, type TimelineDetail } from "./detail"
import { reasoningHeading, Timeline } from "./projection"
import type { TurnPhase } from "./turn-phase-machine"
import { TimelineRow } from "./timeline-row"
import type { WorkStepPolicy, WorkStepTurnStatus } from "./work-steps"

export function workStepTurnStatus(phase: TurnPhase): WorkStepTurnStatus {
  if (phase.status === "working" || phase.status === "thinking") return "live"

  if (phase.status === "failed" || phase.status === "retrying") return "error"

  if (phase.status === "interrupted") return "interrupted"

  return "completed"
}

export function workStepFirstRowByTurn(rows: readonly TimelineRow.TimelineRow[]) {
  const result = new Map<string, string>()

  rows.forEach((row) => {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "context" || !row.group.work) return

    if (!result.has(row.userMessageID)) result.set(row.userMessageID, TimelineRow.key(row))
  })

  return result
}

export function workStepFinalReplyPartByTurn(messages: readonly SessionMessageInfo[]) {
  const result = new Map<string, string>()
  let turnID: string | undefined

  messages.forEach((message) => {
    if (message.type === "user") turnID = message.id

    if (message.type === "shell") turnID = undefined

    if (message.type !== "assistant") return

    turnID ??= message.id

    const reply = Timeline.contentEntries(message).findLast(
      (entry) => entry.content.type === "text" && !!entry.content.text.trim(),
    )

    if (reply) result.set(turnID, reply.id)
  })

  return result
}

export function workStepTurnsWithLaterInput(messages: readonly SessionMessageInfo[]) {
  let laterInput = false

  return new Set(
    messages.reduceRight<string[]>((result, message) => {
      if (message.type !== "user") return result

      if (laterInput) result.push(message.id)
      laterInput = true

      return result
    }, []),
  )
}

export function workStepDetail(parts: readonly ContextGroupPart[], live: boolean, policy: WorkStepPolicy) {
  if (live) {
    const tool = parts.findLast(
      (part) => part.type === "tool" && (part.state.status === "running" || part.state.status === "streaming"),
    )

    if (tool?.type === "tool" && policy.liveProcessDetail) return preview(toolDetail(tool))

    const reasoning = parts.findLast((part) => part.type === "reasoning" && part.streaming)

    if (reasoning?.type === "reasoning") return preview(reasoning.text)

    return
  }

  if (!policy.settledReasoningPreview) return
  const reasoning = parts.findLast((part) => part.type === "reasoning")

  return reasoning?.type === "reasoning" ? preview(reasoning.text) : undefined
}

export function workStepNativeDetailExpanded(
  parts: readonly ContextGroupPart[],
  detail?: TimelineDetail,
) {
  if (!detail) return false

  return parts.some((part) => {
    if (part.type !== "tool" && part.type !== "reasoning") return false
    const category = timelineCategory(part)

    if (!category) return false
    const value = detail[category]

    return "details" in value && value.details === "expanded"
  })
}

function toolDetail(tool: Extract<ContextGroupPart, { type: "tool" }>) {
  const input = currentToolInput(tool)

  const value =
    input.command ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? tool.name

  return Predicate.isString(value) ? value : tool.name
}

function preview(text: string) {
  const value =
    reasoningHeading(text) ??
    text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[#>*_`-]+\s*/, "")

  return value.length > 120 ? `${value.slice(0, 119).trimEnd()}…` : value
}
