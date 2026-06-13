import type { Interface } from "@opencode-ai/core/event"
import type { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { blockedOutput, acceptSpawn, gateSpawn as evaluateSpawn, gateToolCall, policy } from "./index"
import type { AceConfig, AceDecision } from "./policy"
import { emitDecision } from "./trace"
import { skipHumanApproval } from "./headless"

export type AceAsk = (req: {
  permission: "ace"
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
}) => Effect.Effect<void, unknown>

export type GateToolInput = {
  events: Interface
  config: AceConfig | undefined
  sessionID: SessionID
  callID?: string
  tool: string
  ask: AceAsk
}

export type GateSpawnInput = {
  events: Interface
  config: AceConfig | undefined
  sessionID: SessionID
  subagent: string
  depth: number
  ask: AceAsk
  skip?: boolean
}

export type GateSpawnResult = {
  blocked?: string
  tracked: boolean
  decision?: AceDecision
}

export const gateTool = Effect.fn("ACE.middleware.gateTool")(function* (input: GateToolInput) {
  const current = policy(input.config)
  const decision = gateToolCall(input.config, {
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
  })
  if (!decision) return undefined
  yield* emitDecision(input.events, current, decision)
  if (decision.action === "escalate") {
    if (skipHumanApproval(input.config)) return undefined
    const approved = yield* input
      .ask({
        permission: "ace",
        patterns: [`tool:${input.tool}`],
        always: [`tool:${input.tool}`],
        metadata: {
          mode: decision.mode,
          reason: decision.reason ?? "",
          pressure: decision.pressure,
        },
      })
      .pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
    if (approved) return undefined
  }
  if (decision.action === "block" || decision.action === "escalate") return blockedOutput(decision)
  return undefined
})

export const gateSpawn = Effect.fn("ACE.middleware.gateSpawn")(function* (input: GateSpawnInput) {
  if (input.skip) return { tracked: false }
  const current = policy(input.config)
  const decision = evaluateSpawn(input.config, {
    sessionID: input.sessionID,
    subagent: input.subagent,
    depth: input.depth,
  })
  if (!decision) return { tracked: false }
  yield* emitDecision(input.events, current, decision)
  if (decision.action === "escalate") {
    if (skipHumanApproval(input.config)) {
      acceptSpawn(input.sessionID)
      return { tracked: true, decision }
    }
    const approved = yield* input
      .ask({
        permission: "ace",
        patterns: [`spawn:${input.subagent}`],
        always: [`spawn:${input.subagent}`],
        metadata: {
          mode: decision.mode,
          reason: decision.reason ?? "",
          pressure: decision.pressure,
        },
      })
      .pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
    if (approved) {
      acceptSpawn(input.sessionID)
      return { tracked: true, decision }
    }
  }
  if (decision.action === "block" || decision.action === "escalate") {
    return { blocked: blockedOutput(decision), tracked: false, decision }
  }
  return {
    tracked: decision.action === "allow" || decision.action === "observe",
    decision,
  }
})
