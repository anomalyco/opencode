import { Effect, Schema } from "effect"
import type { ReconcileOutput } from "@/evolution/decision/types"
import type { Decision, ConsensusOutcome, DecisionCategory } from "@/evolution/decision/p6-types"

export class BridgeError extends Schema.TaggedErrorClass<BridgeError>()("DecisionBridgeError", {
  message: Schema.String,
}) {}

export type BridgeResult =
  | { readonly type: "NO_ACTION"; readonly reason: string }
  | { readonly type: "DECISION_READY"; readonly decision: Decision }

export function reconcileToDecision(output: ReconcileOutput): Effect.Effect<BridgeResult, BridgeError> {
  if (output.outcome === "BELOW_THRESHOLD") {
    return Effect.succeed({ type: "NO_ACTION", reason: "Confidence below threshold" })
  }

  if (output.outcome === "NO_CANDIDATES") {
    return Effect.succeed({ type: "NO_ACTION", reason: "No candidates produced" })
  }

  if (!output.consensusOutcome) {
    return Effect.fail(new BridgeError({ message: "consensusOutcome is required for DECISION_READY" }))
  }

  if (output.outcome === "PROPOSAL_SUBMITTED" && (!output.proposedAction || !output.rationale)) {
    return Effect.fail(new BridgeError({ message: "PROPOSAL_SUBMITTED requires proposedAction and rationale" }))
  }

  const decision: Decision = {
    decisionId: `dec-${Date.now()}`,
    category: output.decisionCategory ?? "CONFIG_THRESHOLD",
    proposedAction: output.proposedAction ?? "HELD_FOR_REVIEW",
    consensusOutcome: output.consensusOutcome,
    rationale: output.rationale ?? output.vetoReason ?? "No consensus",
    producedAt: Date.now(),
  }

  return Effect.succeed({ type: "DECISION_READY", decision })
}

export * as DecisionBridge from "./bridge"
