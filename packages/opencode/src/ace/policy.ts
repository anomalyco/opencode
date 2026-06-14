import type { ConfigV1 } from "@daemon-protocol/core/v1/config/config"
import type { SessionID } from "@/session/schema"

export type AceMode = "monitor" | "fixed-cap" | "reject-escalate"
export type AceTarget = "tool" | "spawn"
export type AceAction = "allow" | "observe" | "block" | "escalate"

export interface AceLimits {
  toolCallsPerSession: number
  toolCallsPerTurn: number
  spawnsPerSession: number
  spawnDepth: number
  parallelSubagents: number
  windowMs: number
}

export interface AceTracePolicy {
  events: boolean
  logs: boolean
}

export interface AcePolicy {
  enabled: boolean
  mode: AceMode
  limits: AceLimits
  trace: AceTracePolicy
  experiment?: {
    name?: string
    arm?: string
  }
  message?: string
}

export interface AcePressure {
  toolCalls: number
  turnToolCalls: number
  spawns: number
  spawnDepth: number
  activeSubagents: number
  windowMs: number
  kEff?: number
}

export interface AceDecision {
  sessionID: SessionID
  callID?: string
  target: AceTarget
  subject: string
  mode: AceMode
  action: AceAction
  wouldBlock: boolean
  reason?: string
  policy: {
    id?: string
    arm?: string
    source?: string
    limitName?: string
    limitValue?: number
  }
  pressure: AcePressure
}

export type AceConfig = ConfigV1.Info["ace"]
type AceConfigMode = NonNullable<AceConfig>["mode"]

const DEFAULT_LIMITS: AceLimits = {
  toolCallsPerSession: 80,
  toolCallsPerTurn: 30,
  spawnsPerSession: 5,
  spawnDepth: 2,
  parallelSubagents: 3,
  windowMs: 300_000,
}

const DEFAULT_TRACE: AceTracePolicy = {
  events: true,
  logs: false,
}

function normalizeMode(mode: AceConfigMode | undefined): AceMode {
  if (mode === "cap") return "fixed-cap"
  if (mode === "reject") return "reject-escalate"
  if (mode === "fixed-cap" || mode === "reject-escalate" || mode === "monitor") return mode
  return "fixed-cap"
}

export function resolve(config: AceConfig | undefined): AcePolicy {
  const limits = config?.limits
  return {
    enabled: config ? (config.enabled ?? true) : false,
    mode: normalizeMode(config?.mode),
    limits: {
      toolCallsPerSession: config?.maxSteps ?? limits?.toolCallsPerSession ?? DEFAULT_LIMITS.toolCallsPerSession,
      toolCallsPerTurn: limits?.toolCallsPerTurn ?? DEFAULT_LIMITS.toolCallsPerTurn,
      spawnsPerSession: config?.maxSpawns ?? limits?.spawnsPerSession ?? DEFAULT_LIMITS.spawnsPerSession,
      spawnDepth: limits?.spawnDepth ?? DEFAULT_LIMITS.spawnDepth,
      parallelSubagents: limits?.parallelSubagents ?? DEFAULT_LIMITS.parallelSubagents,
      windowMs: limits?.windowMs ?? DEFAULT_LIMITS.windowMs,
    },
    trace: {
      events: config?.trace?.events ?? DEFAULT_TRACE.events,
      logs: config?.trace?.logs ?? DEFAULT_TRACE.logs,
    },
    experiment: config?.experiment,
    message: config?.message,
  }
}

export function actionFor(policy: AcePolicy, wouldBlock: boolean): AceAction {
  if (!wouldBlock) return "allow"
  if (policy.mode === "monitor") return "observe"
  if (policy.mode === "reject-escalate") return "escalate"
  return "block"
}

export function reasonFor(input: {
  policy: AcePolicy
  target: AceTarget
  subject: string
  limitName?: string
  limitValue?: number
}) {
  if (input.policy.message) return input.policy.message
  if (!input.limitName || input.limitValue === undefined) return undefined
  return `ACE ${input.target} ${input.subject} exceeded ${input.limitName}=${input.limitValue}`
}
