/**
 * Bryan Integration Module
 *
 * Provides human-in-loop dialectic capabilities for OpenCode:
 * - Question/Answer workflow with Bryan
 * - Continuation processing for answered questions
 * - Group-based routing (Philosophical Union, Groundwork Guild, Integration Assembly)
 *
 * Ported from: sisyphean-works/bootstrap/tools/dialectic.py, continue.py
 */

export { Dialectic } from "./dialectic"
export { Continuation } from "./continuation"
export { BryanEvents } from "./events"

import { Dialectic } from "./dialectic"
import { Continuation } from "./continuation"
import { Log } from "../util/log"

const log = Log.create({ service: "bryan" })

/**
 * Initialize Bryan integration on session start
 *
 * This should be called at the beginning of each session to:
 * 1. Check for answered questions
 * 2. Report pending continuations
 * 3. Optionally spawn processors
 */
export async function initializeBryan(): Promise<{
  statusMessage?: string
  hasContinuations: boolean
}> {
  log.info("Initializing Bryan integration")

  // Check for continuations
  const result = await Continuation.checkOnStart()

  // Get status message
  const statusMessage = await Continuation.getStatusMessage()

  if (result.hasContinuations) {
    log.info("Bryan has answered questions - continuations pending", {
      count: result.continuations.length,
    })
  }

  return {
    statusMessage,
    hasContinuations: result.hasContinuations,
  }
}

/**
 * Quick helpers for common operations
 */
export const Bryan = {
  /**
   * Ask Bryan a question
   */
  ask: Dialectic.ask,

  /**
   * Get current status
   */
  status: Dialectic.getStatus,

  /**
   * Check for answers and create continuations
   */
  checkAnswers: Dialectic.checkAnswers,

  /**
   * Spawn background agents for pending continuations
   */
  spawnContinuations: Continuation.spawnProcessors,

  /**
   * Process a specific continuation inline
   */
  processContinuation: Continuation.processInline,

  /**
   * Get all pending questions
   */
  getQuestions: Dialectic.getQuestions,

  /**
   * Archive a processed question
   */
  archiveQuestion: Dialectic.archiveQuestion,
}
