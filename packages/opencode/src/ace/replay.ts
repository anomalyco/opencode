import { SessionID as SessionIDSchema } from "@/session/schema"
import { createController } from "./index"
import { policy, type AceDecision } from "./index"
import type { AceConfig, AceMode } from "./policy"
import type { Event } from "@opencode-ai/sdk/v2"

export type AceReplayFooter = {
  mode: AceMode | "off"
  toolCalls: number
  turnToolCalls?: number
  spawns: number
  spawnDepth?: number
  activeSubagents: number
  blocked?: string
}

export type AceReplayEvent = {
  aggregateID: string
  seq: number
  type: string
  data: Record<string, unknown>
}

export type AceReplayPolicy = {
  name?: string
  arm?: string
  ace?: AceConfig
}

export type AceAblationSummary = {
  name: string
  arm?: string
  mode: AceDecision["mode"]
  toolCalls: number
  spawns: number
  wouldBlock: number
  observed: number
  blocked: number
  escalated: number
  completedTools: number
  failedTools: number
  stepEnds: number
  byLimit: Record<string, number>
  firstBlockSeq?: number
}

const DEFAULT_ARMS: AceReplayPolicy[] = [
  { name: "monitor", arm: "monitor", ace: { enabled: true, mode: "monitor" } },
  { name: "fixed-cap", arm: "control", ace: { enabled: true, mode: "fixed-cap" } },
  { name: "reject-escalate", arm: "treatment", ace: { enabled: true, mode: "reject-escalate" } },
]

export function ablate(input: { events: readonly AceReplayEvent[]; policies?: readonly AceReplayPolicy[] }) {
  return (input.policies?.length ? input.policies : DEFAULT_ARMS).map((candidate) =>
    runArm(
      {
        name: candidate.name ?? candidate.ace?.mode ?? "ace",
        arm: candidate.arm,
        ace: candidate.ace ?? { enabled: true, mode: "monitor" },
      },
      input.events,
    ),
  )
}

function runArm(candidate: Required<Pick<AceReplayPolicy, "name" | "ace">> & Pick<AceReplayPolicy, "arm">, events: readonly AceReplayEvent[]) {
  const controller = createController()
  const current = policy(candidate.ace)
  const summary: AceAblationSummary = {
    name: candidate.name,
    ...(candidate.arm ? { arm: candidate.arm } : {}),
    mode: current.mode,
    toolCalls: 0,
    spawns: 0,
    wouldBlock: 0,
    observed: 0,
    blocked: 0,
    escalated: 0,
    completedTools: 0,
    failedTools: 0,
    stepEnds: 0,
    byLimit: {},
  }
  for (const event of events) {
    if (event.type === "session.next.tool.called") {
      const tool = stringValue(event.data.tool)
      if (!tool) continue
      summary.toolCalls += 1
      applyDecision(summary, event.seq, controller.gateToolCall(candidate.ace, {
        sessionID: SessionIDSchema.make(event.aggregateID),
        callID: stringValue(event.data.callID),
        tool,
      }))
      const input = recordValue(event.data.input)
      const subagent = stringValue(input?.subagent_type)
      if (tool === "task" && subagent && !stringValue(input?.task_id)) {
        summary.spawns += 1
        applyDecision(summary, event.seq, controller.gateSpawn(candidate.ace, {
          sessionID: SessionIDSchema.make(event.aggregateID),
          subagent,
          depth: 1,
        }))
      }
      continue
    }
    if (event.type === "session.next.tool.success") {
      summary.completedTools += 1
      finishTaskSpawn(controller, event)
      continue
    }
    if (event.type === "session.next.tool.failed") {
      summary.failedTools += 1
      finishTaskSpawn(controller, event)
      continue
    }
    if (event.type === "session.next.step.ended" || event.type === "session.next.step.failed") {
      summary.stepEnds += 1
      controller.finishStep(SessionIDSchema.make(event.aggregateID))
    }
  }
  return summary
}

function applyDecision(summary: AceAblationSummary, seq: number, decision: AceDecision | undefined) {
  if (!decision) return
  if (decision.wouldBlock) {
    summary.wouldBlock += 1
    summary.firstBlockSeq = summary.firstBlockSeq ?? seq
  }
  if (decision.action === "observe") summary.observed += 1
  if (decision.action === "block") summary.blocked += 1
  if (decision.action === "escalate") summary.escalated += 1
  if (decision.policy.limitName) {
    summary.byLimit[decision.policy.limitName] = (summary.byLimit[decision.policy.limitName] ?? 0) + 1
  }
}

function finishTaskSpawn(controller: ReturnType<typeof createController>, event: AceReplayEvent) {
  if (stringValue(event.data.tool) !== "task") return
  controller.finishSpawn(SessionIDSchema.make(event.aggregateID))
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function recordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function ablationConfig(base: AceConfig, arm: string): AceConfig | undefined {
  if (arm === "no-ace") return { ...base, enabled: false }
  if (arm === "monitor-only") return { ...base, mode: "monitor" }
  if (arm === "control") return { ...base, mode: "monitor" }
  return base
}

export function experimentArm(config: AceConfig | undefined): string | undefined {
  return config?.experiment?.arm
}

const ACE_EVENT_TYPES = new Set([
  "session.next.ace.decision",
  "session.next.ace.pressure",
])

export function reduceReplayEvent(
  event: Event | Record<string, unknown>,
  sessionID: string,
  state: AceReplayFooter,
): AceReplayFooter | undefined {
  const type = typeof event.type === "string" ? event.type : undefined
  if (!type || !ACE_EVENT_TYPES.has(type)) return undefined
  const properties =
    "properties" in event && event.properties && typeof event.properties === "object"
      ? (event.properties as Record<string, unknown>)
      : undefined
  if (!properties || properties.sessionID !== sessionID) return undefined
  const mode = properties.mode as AceMode | undefined
  if (!mode) return undefined
  const pressure = properties.pressure as Record<string, number> | undefined
  const next: AceReplayFooter = pressure
    ? {
        mode,
        toolCalls: pressure.toolCalls ?? state.toolCalls,
        turnToolCalls: pressure.turnToolCalls,
        spawns: pressure.spawns ?? state.spawns,
        spawnDepth: pressure.spawnDepth,
        activeSubagents: pressure.activeSubagents ?? state.activeSubagents,
      }
    : { ...state, mode }
  if (type === "session.next.ace.decision" && properties.action === "block") {
    next.blocked = typeof properties.reason === "string" ? properties.reason : "ACE blocked"
  }
  return next
}

export function formatReplayStatus(footer: AceReplayFooter): string | undefined {
  const parts: string[] = ["ACE", footer.mode]
  if (footer.toolCalls > 0) parts.push(`${footer.toolCalls}tc`)
  if (footer.spawns > 0) parts.push(`${footer.spawns}sp`)
  if (footer.activeSubagents > 0) parts.push(`${footer.activeSubagents}active`)
  return parts.length > 2 ? parts.join(" ") : undefined
}
