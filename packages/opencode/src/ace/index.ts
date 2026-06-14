import type { SessionID } from "@/session/schema"
import {
  actionFor,
  reasonFor,
  resolve,
  type AceConfig,
  type AceDecision,
  type AcePolicy,
  type AcePressure,
  type AceTarget,
} from "./policy"
export { emitDecision, emitPressure } from "./trace"
export * as Middleware from "./middleware"
export * as Headless from "./headless"
export * as Profiles from "./profiles"
export * as Replay from "./replay"
export type { AceConfig, AceDecision, AcePolicy, AcePressure } from "./policy"

interface AceState {
  windowStart: number
  toolCalls: number
  turnToolCalls: number
  spawns: number
  spawnDepth: number
  activeSubagents: number
}

type LimitHit = {
  name: string
  value: number
}

export function createController() {
  const states = new Map<SessionID, AceState>()

  return {
    readState(sessionID: SessionID): AcePressure | undefined {
      const state = states.get(sessionID)
      if (!state) return undefined
      return pressure(state)
    },
    gateToolCall(
      config: AceConfig | undefined,
      input: {
        sessionID: SessionID
        callID?: string
        tool: string
      },
    ): AceDecision | undefined {
      const current = resolve(config)
      if (!current.enabled) return undefined
      const state = getState(states, input.sessionID)
      state.toolCalls += 1
      state.turnToolCalls += 1
      return decide(current, {
        sessionID: input.sessionID,
        callID: input.callID,
        target: "tool",
        subject: input.tool,
        pressure: pressure(state),
        hit: limitHit(current, state, "tool"),
      })
    },
    gateSpawn(
      config: AceConfig | undefined,
      input: {
        sessionID: SessionID
        subagent: string
        depth: number
      },
    ): AceDecision | undefined {
      const current = resolve(config)
      if (!current.enabled) return undefined
      const state = getState(states, input.sessionID)
      state.spawns += 1
      state.spawnDepth = Math.max(state.spawnDepth, input.depth)
      const hit = limitHit(current, state, "spawn")
      const action = actionFor(current, hit !== undefined)
      if (action === "allow" || action === "observe") state.activeSubagents += 1
      return makeDecision(current, {
        sessionID: input.sessionID,
        target: "spawn",
        subject: input.subagent,
        pressure: pressure(state),
        hit,
        action,
      })
    },
    finishSpawn(sessionID: SessionID) {
      const state = getState(states, sessionID)
      state.activeSubagents = Math.max(0, state.activeSubagents - 1)
      return pressure(state)
    },
    acceptSpawn(sessionID: SessionID) {
      const state = getState(states, sessionID)
      state.activeSubagents += 1
      return pressure(state)
    },
    finishStep(sessionID: SessionID) {
      const state = getState(states, sessionID)
      const snapshot = pressure(state)
      state.turnToolCalls = 0
      return snapshot
    },
    resetSession(sessionID: SessionID) {
      const state = states.get(sessionID)
      const snapshot = state ? pressure(state) : emptyPressure()
      states.delete(sessionID)
      return snapshot
    },
    seedFromPressure(sessionID: SessionID, snapshot: AcePressure) {
      states.set(sessionID, {
        windowStart: Date.now() - snapshot.windowMs,
        toolCalls: snapshot.toolCalls,
        turnToolCalls: snapshot.turnToolCalls,
        spawns: snapshot.spawns,
        spawnDepth: snapshot.spawnDepth,
        activeSubagents: snapshot.activeSubagents,
      })
      return snapshot
    },
  }
}

const controller = createController()

export function policy(config: AceConfig | undefined) {
  return resolve(config)
}

export function readState(sessionID: SessionID): AcePressure | undefined {
  return controller.readState(sessionID)
}

export function gateToolCall(
  config: AceConfig | undefined,
  input: {
    sessionID: SessionID
    callID?: string
    tool: string
  },
): AceDecision | undefined {
  return controller.gateToolCall(config, input)
}

export function gateSpawn(
  config: AceConfig | undefined,
  input: {
    sessionID: SessionID
    subagent: string
    depth: number
  },
): AceDecision | undefined {
  return controller.gateSpawn(config, input)
}

export function finishSpawn(sessionID: SessionID) {
  return controller.finishSpawn(sessionID)
}

export function acceptSpawn(sessionID: SessionID) {
  return controller.acceptSpawn(sessionID)
}

export function finishStep(sessionID: SessionID) {
  return controller.finishStep(sessionID)
}

export function resetSession(sessionID: SessionID) {
  return controller.resetSession(sessionID)
}

export function seedFromPressure(sessionID: SessionID, snapshot: AcePressure) {
  return controller.seedFromPressure(sessionID, snapshot)
}

export function blockedOutput(decision: AceDecision) {
  return decision.reason ?? `ACE ${decision.target} blocked by ${decision.mode}`
}

function getState(states: Map<SessionID, AceState>, sessionID: SessionID) {
  const existing = states.get(sessionID)
  if (existing) return existing
  const state = {
    windowStart: Date.now(),
    toolCalls: 0,
    turnToolCalls: 0,
    spawns: 0,
    spawnDepth: 0,
    activeSubagents: 0,
  }
  states.set(sessionID, state)
  return state
}

function limitHit(policy: AcePolicy, state: AceState, target: AceTarget): LimitHit | undefined {
  if (target === "tool" && state.turnToolCalls > policy.limits.toolCallsPerTurn) {
    return { name: "toolCallsPerTurn", value: policy.limits.toolCallsPerTurn }
  }
  if (target === "tool" && state.toolCalls > policy.limits.toolCallsPerSession) {
    return { name: "toolCallsPerSession", value: policy.limits.toolCallsPerSession }
  }
  if (target === "spawn" && state.spawns > policy.limits.spawnsPerSession) {
    return { name: "spawnsPerSession", value: policy.limits.spawnsPerSession }
  }
  if (target === "spawn" && state.spawnDepth > policy.limits.spawnDepth) {
    return { name: "spawnDepth", value: policy.limits.spawnDepth }
  }
  if (target === "spawn" && state.activeSubagents + 1 > policy.limits.parallelSubagents) {
    return { name: "parallelSubagents", value: policy.limits.parallelSubagents }
  }
  return undefined
}

function decide(
  policy: AcePolicy,
  input: {
    sessionID: SessionID
    callID?: string
    target: AceTarget
    subject: string
    pressure: AcePressure
    hit?: LimitHit
  },
) {
  return makeDecision(policy, {
    ...input,
    action: actionFor(policy, input.hit !== undefined),
  })
}

function makeDecision(
  policy: AcePolicy,
  input: {
    sessionID: SessionID
    callID?: string
    target: AceTarget
    subject: string
    pressure: AcePressure
    hit?: LimitHit
    action: AceDecision["action"]
  },
): AceDecision {
  const wouldBlock = input.hit !== undefined
  return {
    sessionID: input.sessionID,
    ...(input.callID ? { callID: input.callID } : {}),
    target: input.target,
    subject: input.subject,
    mode: policy.mode,
    action: input.action,
    wouldBlock,
    ...(wouldBlock
      ? {
          reason: reasonFor({
            policy,
            target: input.target,
            subject: input.subject,
            limitName: input.hit?.name,
            limitValue: input.hit?.value,
          }),
        }
      : {}),
    policy: {
      ...(policy.experiment?.name ? { id: policy.experiment.name } : {}),
      ...(policy.experiment?.arm ? { arm: policy.experiment.arm } : {}),
      source: "opencode.jsonc",
      ...(input.hit ? { limitName: input.hit.name, limitValue: input.hit.value } : {}),
    },
    pressure: input.pressure,
  }
}

function pressure(state: AceState): AcePressure {
  return {
    toolCalls: state.toolCalls,
    turnToolCalls: state.turnToolCalls,
    spawns: state.spawns,
    spawnDepth: state.spawnDepth,
    activeSubagents: state.activeSubagents,
    windowMs: Math.max(0, Date.now() - state.windowStart),
    kEff: state.spawns === 0 ? 0 : state.spawns / Math.max(1, state.toolCalls + state.activeSubagents),
  }
}

function emptyPressure(): AcePressure {
  return {
    toolCalls: 0,
    turnToolCalls: 0,
    spawns: 0,
    spawnDepth: 0,
    activeSubagents: 0,
    windowMs: 0,
    kEff: 0,
  }
}

export * as ACE from "."
