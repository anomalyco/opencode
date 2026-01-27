/**
 * ULTRAWORK Loop - Autonomous Execution Loop
 *
 * Implements the Ralph Wiggum-style autonomous loop pattern
 * that keeps the AI working until the task is DONE.
 *
 * Features:
 * - Binary success criteria (objectively measurable)
 * - Iteration-limited execution (prevent infinite token burn)
 * - Self-correction on failure
 * - Progress tracking and reporting
 * - Doom loop detection and escape
 * - Automatic mode switching based on task phase
 *
 * Inspired by:
 * - Ralph Wiggum plugin for Claude Code
 * - ClawdBot's 24/7 daemon loop
 * - OpenHands' perception-action loop
 * - Roo Code's boomerang tasks
 */

import { Log } from "../util/log"
import { UltraworkModes, type UltraworkMode } from "./modes"

export namespace UltraworkLoop {
  const log = Log.create({ service: "ultrawork.loop" })

  /**
   * Success criteria for autonomous execution.
   * Must be objectively measurable - no vague conditions.
   */
  export interface SuccessCriteria {
    id: string
    description: string
    check: () => Promise<boolean> | boolean
  }

  /**
   * Configuration for the autonomous loop
   */
  export interface LoopConfig {
    maxIterations: number
    successCriteria: SuccessCriteria[]
    onProgress?: (iteration: number, status: IterationStatus) => void
    onModeSwitch?: (from: UltraworkMode, to: UltraworkMode) => void
    enableAutoModeSwitch: boolean
    doomLoopThreshold: number // consecutive failures before forced stop
    cooldownMs: number // delay between iterations
    timeoutMs: number // max total execution time
  }

  export const DEFAULT_LOOP_CONFIG: LoopConfig = {
    maxIterations: 50,
    successCriteria: [],
    enableAutoModeSwitch: true,
    doomLoopThreshold: 5,
    cooldownMs: 1000,
    timeoutMs: 1800_000, // 30 minutes
  }

  /**
   * Status of a single iteration
   */
  export interface IterationStatus {
    iteration: number
    mode: UltraworkMode
    criteriaResults: { id: string; met: boolean }[]
    allCriteriaMet: boolean
    doomLoopRisk: boolean
    elapsedMs: number
  }

  /**
   * Result of the autonomous loop execution
   */
  export interface LoopResult {
    success: boolean
    iterations: number
    finalMode: UltraworkMode
    criteriaResults: { id: string; met: boolean }[]
    doomLoopDetected: boolean
    totalMs: number
    history: IterationStatus[]
  }

  /**
   * Execute the autonomous loop.
   *
   * The loop runs the task function repeatedly, checking success criteria
   * after each iteration. It stops when:
   * 1. All success criteria are met (success)
   * 2. Max iterations reached (failure)
   * 3. Doom loop detected (failure)
   * 4. Timeout exceeded (failure)
   *
   * @param taskFn - The function to execute each iteration
   * @param config - Loop configuration
   */
  export async function execute(
    taskFn: (iteration: number, mode: UltraworkMode) => Promise<void>,
    config: Partial<LoopConfig> = {},
  ): Promise<LoopResult> {
    const cfg = { ...DEFAULT_LOOP_CONFIG, ...config }
    const startTime = Date.now()
    let currentMode: UltraworkMode = "architect"
    let consecutiveFailures = 0
    const history: IterationStatus[] = []

    log.info("autonomous loop started", {
      maxIterations: cfg.maxIterations,
      criteria: cfg.successCriteria.length,
      timeout: cfg.timeoutMs,
    })

    for (let iteration = 1; iteration <= cfg.maxIterations; iteration++) {
      const elapsed = Date.now() - startTime

      // Check timeout
      if (elapsed > cfg.timeoutMs) {
        log.warn("autonomous loop timeout", { iteration, elapsed })
        return buildResult(false, iteration - 1, currentMode, history, false, elapsed)
      }

      // Auto mode switching
      if (cfg.enableAutoModeSwitch) {
        const suggestedMode = suggestMode(iteration, cfg.maxIterations, consecutiveFailures)
        if (suggestedMode !== currentMode) {
          log.info("auto-switching mode", { from: currentMode, to: suggestedMode })
          cfg.onModeSwitch?.(currentMode, suggestedMode)
          currentMode = suggestedMode
        }
      }

      // Execute the task
      try {
        await taskFn(iteration, currentMode)
        consecutiveFailures = 0
      } catch (error: any) {
        consecutiveFailures++
        log.warn("iteration failed", {
          iteration,
          error: error.message,
          consecutiveFailures,
        })
      }

      // Check success criteria
      const criteriaResults = await checkCriteria(cfg.successCriteria)
      const allMet = criteriaResults.every((r) => r.met)
      const doomLoopRisk = consecutiveFailures >= cfg.doomLoopThreshold

      const status: IterationStatus = {
        iteration,
        mode: currentMode,
        criteriaResults,
        allCriteriaMet: allMet,
        doomLoopRisk,
        elapsedMs: Date.now() - startTime,
      }
      history.push(status)

      // Report progress
      cfg.onProgress?.(iteration, status)

      // Check completion
      if (allMet) {
        log.info("all criteria met - loop complete", {
          iterations: iteration,
          elapsed: Date.now() - startTime,
        })
        return buildResult(true, iteration, currentMode, history, false, Date.now() - startTime)
      }

      // Check doom loop
      if (doomLoopRisk) {
        log.error("doom loop detected - forcing stop", {
          consecutiveFailures,
          iteration,
        })
        return buildResult(false, iteration, currentMode, history, true, Date.now() - startTime)
      }

      // Cooldown between iterations
      if (cfg.cooldownMs > 0 && iteration < cfg.maxIterations) {
        await sleep(cfg.cooldownMs)
      }
    }

    // Max iterations reached
    const finalCriteria = await checkCriteria(cfg.successCriteria)
    const totalMs = Date.now() - startTime
    log.warn("max iterations reached", {
      iterations: cfg.maxIterations,
      criteriaMetCount: finalCriteria.filter((c) => c.met).length,
      totalMs,
    })

    return buildResult(
      finalCriteria.every((c) => c.met),
      cfg.maxIterations,
      currentMode,
      history,
      false,
      totalMs,
    )
  }

  /**
   * Create pre-defined success criteria from common patterns
   */
  export const Criteria = {
    /**
     * Check that a shell command exits successfully
     */
    commandSucceeds(command: string, description?: string): SuccessCriteria {
      return {
        id: `cmd:${command.substring(0, 50)}`,
        description: description ?? `Command succeeds: ${command}`,
        check: async () => {
          try {
            const proc = Bun.spawn(["sh", "-c", command], {
              stdout: "pipe",
              stderr: "pipe",
            })
            const code = await proc.exited
            return code === 0
          } catch {
            return false
          }
        },
      }
    },

    /**
     * Check that a file exists
     */
    fileExists(filePath: string): SuccessCriteria {
      return {
        id: `file:${filePath}`,
        description: `File exists: ${filePath}`,
        check: async () => {
          try {
            await Bun.file(filePath).exists()
            return true
          } catch {
            return false
          }
        },
      }
    },

    /**
     * Check that tests pass
     */
    testsPass(testCommand: string = "npm test"): SuccessCriteria {
      return Criteria.commandSucceeds(testCommand, "All tests pass")
    },

    /**
     * Check that build succeeds
     */
    buildSucceeds(buildCommand: string = "npm run build"): SuccessCriteria {
      return Criteria.commandSucceeds(buildCommand, "Build succeeds")
    },

    /**
     * Check that linting passes
     */
    lintPasses(lintCommand: string = "npm run lint"): SuccessCriteria {
      return Criteria.commandSucceeds(lintCommand, "Lint passes")
    },

    /**
     * Custom boolean check
     */
    custom(id: string, description: string, check: () => Promise<boolean> | boolean): SuccessCriteria {
      return { id, description, check }
    },
  }

  // --- Internal helpers ---

  async function checkCriteria(
    criteria: SuccessCriteria[],
  ): Promise<{ id: string; met: boolean }[]> {
    return Promise.all(
      criteria.map(async (c) => {
        try {
          const met = await c.check()
          return { id: c.id, met }
        } catch {
          return { id: c.id, met: false }
        }
      }),
    )
  }

  function suggestMode(
    iteration: number,
    maxIterations: number,
    consecutiveFailures: number,
  ): UltraworkMode {
    const progress = iteration / maxIterations

    // If failing repeatedly, switch to debug mode
    if (consecutiveFailures >= 2) return "debug"

    // Phase-based mode switching
    if (progress < 0.15) return "architect" // Planning phase
    if (progress < 0.75) return "code"      // Implementation phase
    if (progress < 0.90) return "test"      // Testing phase
    return "code" // Final fixes
  }

  function buildResult(
    success: boolean,
    iterations: number,
    finalMode: UltraworkMode,
    history: IterationStatus[],
    doomLoopDetected: boolean,
    totalMs: number,
  ): LoopResult {
    const lastStatus = history[history.length - 1]
    return {
      success,
      iterations,
      finalMode,
      criteriaResults: lastStatus?.criteriaResults ?? [],
      doomLoopDetected,
      totalMs,
      history,
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
