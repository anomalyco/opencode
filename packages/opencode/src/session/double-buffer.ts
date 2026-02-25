import { Log } from "../util/log"
import { Config } from "@/config/config"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "@/provider/transform"

export namespace DoubleBuffer {
  const log = Log.create({ service: "session.double-buffer" })

  export type Phase = "normal" | "checkpoint_pending" | "concurrent"

  export interface State {
    phase: Phase
    checkpointSummary: string | null
    checkpointMessageCount: number
    lastInputTokens: number
    generation: number
  }

  // Per-session state storage
  const sessions = new Map<string, State>()

  export function getState(sessionID: string): State {
    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, {
        phase: "normal",
        checkpointSummary: null,
        checkpointMessageCount: 0,
        lastInputTokens: 0,
        generation: 0,
      })
    }
    return sessions.get(sessionID)!
  }

  export function resetState(sessionID: string): void {
    sessions.delete(sessionID)
  }

  /**
   * Get configurable thresholds. Uses config if available, otherwise defaults.
   * Default checkpoint at 50% (early, high-quality summary), swap at 75% (current behavior).
   */
  export async function getThresholds(model: Provider.Model): Promise<{
    checkpointThreshold: number
    swapThreshold: number
    maxTokens: number
  }> {
    const config = await Config.get()
    const context = model.limit.context
    if (context === 0) return { checkpointThreshold: 0, swapThreshold: 0, maxTokens: 0 }

    const COMPACTION_BUFFER = 20_000
    const reserved =
      (config.compaction as any)?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(model))
    const usable = model.limit.input
      ? model.limit.input - reserved
      : context - ProviderTransform.maxOutputTokens(model)

    // Configurable thresholds from config, default to 0.50/0.75
    const checkpointPct = (config.compaction as any)?.checkpointThreshold ?? 0.5
    const swapPct = (config.compaction as any)?.swapThreshold ?? 0.75

    return {
      checkpointThreshold: Math.floor(usable * checkpointPct),
      swapThreshold: Math.floor(usable * swapPct),
      maxTokens: usable,
    }
  }

  /**
   * Check if we should start a background checkpoint.
   * Fires when in NORMAL phase and tokens exceed checkpoint threshold.
   */
  export async function shouldCheckpoint(input: {
    sessionID: string
    tokens: { input: number; output: number; cache: { read: number; write: number }; total?: number }
    model: Provider.Model
  }): Promise<boolean> {
    const state = getState(input.sessionID)
    if (state.phase !== "normal") return false

    const count =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
    state.lastInputTokens = count

    const { checkpointThreshold } = await getThresholds(input.model)
    if (checkpointThreshold === 0) return false

    const result = count >= checkpointThreshold
    if (result) {
      log.info("checkpoint threshold reached", {
        sessionID: input.sessionID,
        tokens: count,
        threshold: checkpointThreshold,
        phase: state.phase,
      })
    }
    return result
  }

  /**
   * Check if we should swap buffers (use pre-computed summary).
   * This replaces the existing isOverflow check when a checkpoint exists.
   */
  export async function shouldSwap(input: {
    sessionID: string
    tokens: { input: number; output: number; cache: { read: number; write: number }; total?: number }
    model: Provider.Model
  }): Promise<boolean> {
    const state = getState(input.sessionID)
    if (state.phase !== "concurrent") return false
    if (!state.checkpointSummary) return false

    const count =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
    state.lastInputTokens = count

    const { swapThreshold } = await getThresholds(input.model)
    if (swapThreshold === 0) return false

    const result = count >= swapThreshold
    if (result) {
      log.info("swap threshold reached", {
        sessionID: input.sessionID,
        tokens: count,
        threshold: swapThreshold,
        phase: state.phase,
        generation: state.generation,
      })
    }
    return result
  }

  /**
   * Begin the checkpoint phase. Records the message count at checkpoint time.
   */
  export function beginCheckpoint(sessionID: string, messageCount: number): void {
    const state = getState(sessionID)
    state.phase = "checkpoint_pending"
    state.checkpointMessageCount = messageCount
    log.info("checkpoint started", {
      sessionID,
      messageCount,
      tokens: state.lastInputTokens,
    })
  }

  /**
   * Complete the checkpoint with a summary. Transitions to concurrent phase.
   */
  export function finishCheckpoint(sessionID: string, summary: string): void {
    const state = getState(sessionID)
    state.phase = "concurrent"
    state.checkpointSummary = summary
    state.generation++
    log.info("checkpoint complete", {
      sessionID,
      generation: state.generation,
      summaryLength: summary.length,
    })
  }

  /**
   * Complete the swap. Resets to normal phase for next cycle.
   */
  export function completeSwap(sessionID: string): void {
    const state = getState(sessionID)
    log.info("swap complete", {
      sessionID,
      generation: state.generation,
    })
    state.phase = "normal"
    state.checkpointSummary = null
    state.checkpointMessageCount = 0
  }
}
