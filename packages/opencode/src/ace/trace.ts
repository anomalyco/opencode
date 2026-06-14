import { DateTime, Effect } from "effect"
import { SessionEvent } from "@opencode-ai/core/session/event"
import type { ID, Interface } from "@opencode-ai/core/event"
import type { AceDecision, AcePolicy, AcePressure } from "./policy"

export const emitDecision = Effect.fn("ACE.emitDecision")(function* (
  events: Interface,
  policy: AcePolicy,
  decision: AceDecision,
) {
  if (!policy.enabled || !policy.trace.events) return undefined
  const published = yield* events.publish(SessionEvent.ACE.Decision, {
    sessionID: decision.sessionID,
    ...(decision.callID ? { callID: decision.callID } : {}),
    target: decision.target,
    subject: decision.subject,
    mode: decision.mode,
    action: decision.action,
    wouldBlock: decision.wouldBlock,
    ...(decision.reason ? { reason: decision.reason } : {}),
    policy: decision.policy,
    pressure: decision.pressure,
    timestamp: DateTime.makeUnsafe(Date.now()),
  })
  if (policy.trace.logs) {
    yield* Effect.logInfo("ace.decision", {
      sessionID: decision.sessionID,
      target: decision.target,
      subject: decision.subject,
      mode: decision.mode,
      action: decision.action,
      wouldBlock: decision.wouldBlock,
      reason: decision.reason,
      pressure: decision.pressure,
    })
  }
  return published
})

export const emitPressure = Effect.fn("ACE.emitPressure")(function* (
  events: Interface,
  policy: AcePolicy,
  pressure: AcePressure,
  sessionID: AceDecision["sessionID"],
  decisionID?: ID,
) {
  if (!policy.enabled || !policy.trace.events) return
  yield* events.publish(SessionEvent.ACE.PressureUpdated, {
    sessionID,
    mode: policy.mode,
    pressure,
    ...(decisionID ? { lastDecisionID: decisionID } : {}),
    timestamp: DateTime.makeUnsafe(Date.now()),
  })
  if (policy.trace.logs) {
    yield* Effect.logInfo("ace.pressure", {
      sessionID,
      mode: policy.mode,
      pressure,
    })
  }
})
