/**
 * Ralph Loop - Continuous Execution Until Completion
 *
 * Implements the Ralph Loop pattern for continuous execution until a completion
 * marker is found. Named after the Ralph Wiggum meme: "I'm in danger" -> keeps going.
 *
 * Features:
 * - Completion marker detection (<promise>DONE</promise>)
 * - Iteration tracking and limits
 * - State persistence via Storage API (with locking)
 * - Event bus integration for status updates
 *
 * Ported from: scripts/orchestration_state.py
 * Uses: opencode's Storage API, Lock system, and Event Bus
 */

import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { OrchestrationEvents } from "./events"

const log = Log.create({ service: "ralph-loop" })

export namespace RalphLoop {
  /**
   * State shape for Ralph Loop
   */
  export interface State {
    active: boolean
    prompt: string
    iteration: number
    maxIterations: number
    startedAt: string
    sessionId: string
    completionMarker: string
    stoppedAt?: string
    stopReason?: string
  }

  /**
   * Default completion marker that signals the loop should stop
   */
  export const DEFAULT_MARKER = "<promise>DONE</promise>"

  /**
   * Storage key for Ralph Loop state
   */
  const STORAGE_KEY = ["orchestration", "ralph-loop"]

  /**
   * Start a new Ralph Loop
   */
  export async function start(options: {
    prompt: string
    maxIterations?: number
    sessionId?: string
  }): Promise<State> {
    const state: State = {
      active: true,
      prompt: options.prompt,
      iteration: 1,
      maxIterations: options.maxIterations ?? 100,
      startedAt: new Date().toISOString(),
      sessionId: options.sessionId ?? "",
      completionMarker: DEFAULT_MARKER,
    }

    await Storage.write(STORAGE_KEY, state)

    log.info("Ralph Loop started", {
      maxIterations: state.maxIterations,
      promptLength: options.prompt.length,
    })

    Bus.publish(OrchestrationEvents.RalphLoopStarted, {
      maxIterations: state.maxIterations,
      sessionId: state.sessionId,
    })

    return state
  }

  /**
   * Get current Ralph Loop state if active
   */
  export async function get(): Promise<State | undefined> {
    try {
      const state = await Storage.read<State>(STORAGE_KEY)
      if (state?.active) {
        return state
      }
    } catch {
      // No state exists
    }
    return undefined
  }

  /**
   * Check if a response contains the completion marker
   */
  export async function checkCompletion(responseText: string): Promise<boolean> {
    const state = await get()
    if (!state) {
      return true // No loop active, consider complete
    }

    const marker = state.completionMarker || DEFAULT_MARKER
    return responseText.toLowerCase().includes(marker.toLowerCase())
  }

  /**
   * Increment the iteration counter atomically
   */
  export async function incrementIteration(): Promise<State | undefined> {
    try {
      const state = await Storage.update<State>(STORAGE_KEY, (draft) => {
        if (draft?.active) {
          draft.iteration = (draft.iteration || 1) + 1
        }
      })
      return state?.active ? state : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Stop the Ralph Loop
   */
  export async function stop(reason: string = "completed"): Promise<void> {
    const state = await get()
    const iteration = state?.iteration ?? 0

    await Storage.update<State>(STORAGE_KEY, (draft) => {
      if (draft) {
        draft.active = false
        draft.stoppedAt = new Date().toISOString()
        draft.stopReason = reason
      }
    })

    log.info("Ralph Loop stopped", { reason, iterationsCompleted: iteration })

    Bus.publish(OrchestrationEvents.RalphLoopStopped, {
      reason,
      iterationsCompleted: iteration,
    })
  }

  /**
   * Check if continuation is needed and return the continuation prompt if so
   */
  export async function checkContinuation(
    transcriptSummary: string
  ): Promise<{ shouldContinue: boolean; prompt?: string }> {
    const state = await get()
    if (!state) {
      return { shouldContinue: false }
    }

    // Check if completion marker found
    if (await checkCompletion(transcriptSummary)) {
      await stop("completed - DONE marker found")
      return { shouldContinue: false }
    }

    // Check iteration limit
    if (state.iteration >= state.maxIterations) {
      await stop(`max iterations reached (${state.maxIterations})`)
      return { shouldContinue: false }
    }

    // Increment and continue
    const newState = await incrementIteration()
    if (!newState) {
      return { shouldContinue: false }
    }

    const continuationPrompt = `[RALPH LOOP - Iteration ${newState.iteration}/${newState.maxIterations}]

The previous iteration did not include ${DEFAULT_MARKER}.
Continue working on the task. When truly complete, include ${DEFAULT_MARKER} in your response.

Original task: ${state.prompt}

Continue from where you left off. Do NOT repeat completed work.`

    return {
      shouldContinue: true,
      prompt: continuationPrompt,
    }
  }

  /**
   * Check if Ralph Loop is currently active
   */
  export async function isActive(): Promise<boolean> {
    const state = await get()
    return state?.active ?? false
  }
}
