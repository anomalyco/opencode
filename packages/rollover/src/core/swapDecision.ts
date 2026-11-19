/** Swap decision (spec Part A §8.3). Pure function. */
import type { NMessage } from "./types"
import type { SessionState } from "./types"
import { isRealUserMessage } from "./view"

export interface SwapContext {
  msgs: NMessage[]
  st: SessionState
  thresholdValue: number
  toolsOpen: boolean
  contextTokens: number | null
  /**
   * Which message anchors the decision: `"last"` (default) evaluates the last
   * message — right inside the context hook, where the last message is the
   * fresh user prompt. `"lastUser"` anchors on the last real user message —
   * for a decision taken between turns, e.g. from the `/rollover` command,
   * where the last message is the assistant's finished reply.
   */
  anchor?: "last" | "lastUser"
  /**
   * Explicit user-triggered re-decision: the automatic flow records one
   * decision per user prompt — a prompt marked decided while the context was
   * still below the threshold stays decided there, so once the threshold is
   * crossed (mid-turn), re-evaluating the same prompt finds it "already
   * decided" and the swap could never complete on the immediate path. The
   * `/rollover` command's immediate swap passes this to re-evaluate
   * regardless; the automatic context hook keeps the one-decision gate.
   */
  ignoreDecided?: boolean
}

export type SwapDecision =
  | { action: "swap"; userMessageId: string }
  | { action: "none"; markDecided: boolean; userMessageId: string }
  | { action: "defer"; reason: "open_tools"; userMessageId: string }

export function decideSwap(ctx: SwapContext): SwapDecision {
  const { msgs, st } = ctx
  const last = ctx.anchor === "lastUser" ? [...msgs].reverse().find(isRealUserMessage) : msgs[msgs.length - 1]

  // Condition 1: last must be a real user message.
  if (!last || !isRealUserMessage(last)) {
    // still need a userMessageId for the result; use last.id if present
    const id = last?.id ?? ""
    return { action: "none", markDecided: false, userMessageId: id }
  }
  // Condition 2: not already decided.
  if (!ctx.ignoreDecided && st.decidedUserMessageIds.includes(last.id)) {
    return { action: "none", markDecided: false, userMessageId: last.id }
  }
  // Condition 3: at least one prior completed assistant turn.
  const hasAssistant = msgs.some((m) => m.role === "assistant")
  if (!hasAssistant) {
    return { action: "none", markDecided: false, userMessageId: last.id }
  }

  const contextTokens = ctx.contextTokens ?? st.lastContextTokens

  // Condition 4: threshold reached.
  if (contextTokens < ctx.thresholdValue) {
    return { action: "none", markDecided: true, userMessageId: last.id }
  }

  // Condition 5: safe point. The only remaining blocker is an open tool part:
  // extraction can no longer gate the swap (v2) — it is background enrichment.
  if (ctx.toolsOpen) {
    return { action: "defer", reason: "open_tools", userMessageId: last.id }
  }

  return { action: "swap", userMessageId: last.id }
}
