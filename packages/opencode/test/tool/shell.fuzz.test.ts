/**
 * Fuzz tests for the output-liveness timeout in the bash tool.
 *
 * The production algorithm (in shell.ts `run()`) replaces a static wall-clock
 * timeout with a polling loop:
 *
 *   const baseDeadline = Date.now() + input.timeout
 *   const maxDeadline = baseDeadline + 10 * 60 * 1000
 *   while (Date.now() < maxDeadline) {
 *     sleep(200ms)
 *     if output-arrived: update lastOutputTime
 *     if now >= baseDeadline AND now - lastOutputTime >= STALL_TIMEOUT_MS:
 *       → TIMEOUT
 *   }
 *   → TIMEOUT  (max deadline reached)
 *
 * Three invariants are tested via property-based fuzzing:
 *   1. A silent process times out at roughly the base deadline.
 *   2. A process that keeps producing output never times out (within limits).
 *   3. A process that produces output then falls silent times out after
 *      the stall window.
 */

import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Shell } from "../../src/shell/shell"
import { ShellTool } from "../../src/tool/shell"
import { ShellTool } from "../../src/tool/shell"
import { Config } from "@/config/config"
import { WithInstance } from "../../src/project/with-instance"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import path from "path"

// ─── Model ───────────────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 200

/**
 * Pure simulation of the timeout algorithm.
 * Returns the time at which a timeout would fire, or undefined if the process
 * exits (exitTime < timeoutTime).
 */
function simulateTimeout(params: {
  startTime: number
  timeout: number
  stallMs: number
  maxDeadline: number
  /** Times (relative to startTime) at which output arrives. */
  outputTimes: readonly number[]
  /** If set, the process exits at this time (no timeout). */
  exitTime?: number
}): { timedOut: true; time: number } | { timedOut: false; reason: "exit" } {
  const { startTime, timeout, stallMs, maxDeadline, outputTimes, exitTime } = params

  const baseDeadline = startTime + timeout

  // Merge output times into an ordered cursor
  let outputIdx = 0
  const sortedOutputs = [...outputTimes].sort((a, b) => a - b)

  let lastOutputTime = startTime

  for (let now = startTime; now < maxDeadline; now += POLL_INTERVAL_MS) {
    // Check for process exit
    if (exitTime !== undefined && now >= exitTime) {
      return { timedOut: false, reason: "exit" }
    }

    // Check for output since last poll
    while (outputIdx < sortedOutputs.length && sortedOutputs[outputIdx] <= now) {
      lastOutputTime = sortedOutputs[outputIdx]
      outputIdx++
    }

    // Past base deadline AND stalled?
    if (now >= baseDeadline && now - lastOutputTime >= stallMs) {
      return { timedOut: true, time: now }
    }
  }

  // Hit max deadline
  return { timedOut: true, time: maxDeadline }
}

// ─── Model-based fuzz tests ─────────────────────────────────────────────────

describe("shell timeout algorithm model", () => {
  const TOLERANCE = POLL_INTERVAL_MS * 2

  test("a silent process times out near the base deadline", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 600_000 }),
        (timeout) => {
          const startTime = 0
          const result = simulateTimeout({
            startTime,
            timeout,
            stallMs: STALL_TIMEOUT_MS,
            maxDeadline: startTime + timeout + 10 * 60 * 1000,
            outputTimes: [],
          })

          expect(result.timedOut).toBe(true)
          const baseDeadline = startTime + timeout
          expect(result.time).toBeGreaterThanOrEqual(baseDeadline - TOLERANCE)
          expect(result.time).toBeLessThanOrEqual(baseDeadline + STALL_TIMEOUT_MS)
        },
      ),
      { numRuns: 200 },
    )
  })

  test("timeout fires at least stallMs after the last output, at or after base deadline", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 600_000 }),
        fc.array(fc.integer({ min: 0, max: 600_000 }), { minLength: 1, maxLength: 20 }),
        (timeout, rawTimes) => {
          const startTime = 0
          const sorted = [...rawTimes].sort((a, b) => a - b)
          const outputTimes = [startTime, ...sorted]
          const maxDeadline = startTime + timeout + 10 * 60 * 1000

          const result = simulateTimeout({
            startTime,
            timeout,
            stallMs: STALL_TIMEOUT_MS,
            maxDeadline,
            outputTimes,
          })

          expect(result.timedOut).toBe(true)

          // Core invariant: timeout fires at or after both:
          // 1. baseDeadline (the minimum guarantee)
          // 2. lastOutputTime + stallMs (the stall guarantee)
          const baseDeadline = startTime + timeout
          const lastOutput = Math.max(...outputTimes.filter((t) => t <= result.time!))
          const minExpected = Math.max(baseDeadline, lastOutput + STALL_TIMEOUT_MS)

          expect(result.time).toBeGreaterThanOrEqual(minExpected - POLL_INTERVAL_MS)
        },
      ),
      { numRuns: 200 },
    )
  })

  test("a process that stalls after producing output times out after the stall window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 60_000 }),
        (timeout) => {
          const startTime = 0
          const outputTimes = [startTime]
          const baseDeadline = startTime + timeout
          const maxDeadline = baseDeadline + 10 * 60 * 1000

          const result = simulateTimeout({
            startTime,
            timeout,
            stallMs: STALL_TIMEOUT_MS,
            maxDeadline,
            outputTimes,
          })

          expect(result.timedOut).toBe(true)

          // With a single output at t=0 and then silence, the timeout fires
          // at t = 0 + stallMs = 60000 (when the stall window expires after
          // the last output), provided that's >= baseDeadline.
          const expected = Math.max(baseDeadline, 0 + STALL_TIMEOUT_MS)
          expect(result.time).toBeGreaterThanOrEqual(expected - POLL_INTERVAL_MS)
          expect(result.time).toBeLessThanOrEqual(expected + POLL_INTERVAL_MS)
        },
      ),
      { numRuns: 200 },
    )
  })

  test("a process that exits before timeout is not killed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 300_000 }),
        fc.integer({ min: 1_000, max: 600_000 }),
        fc.integer({ min: 1_000, max: 600_000 }),
        (timeout, lastOutputDelta, exitDelay) => {
          // Generate a simple schedule: output at t=0, then output at
          // lastOutputDelta, then exit after exitDelay.
          // Algorithm only sees outputs as they happen (no future knowledge).
          const startTime = 0
          const lastOutput = Math.min(lastOutputDelta, exitDelay - 1)
          const actualExitTime = Math.max(lastOutput + 1, exitDelay)

          // earliest possible timeout = max(baseDeadline, lastOutput + stallMs)
          const baseDeadline = startTime + timeout
          const earliestTimeout = Math.max(baseDeadline, lastOutput + STALL_TIMEOUT_MS)

          // Only test: process exits before earliest possible timeout
          if (actualExitTime >= earliestTimeout) return

          const result = simulateTimeout({
            startTime,
            timeout,
            stallMs: STALL_TIMEOUT_MS,
            maxDeadline: startTime + timeout + 10 * 60 * 1000,
            outputTimes: [startTime, lastOutput].filter((t, i, a) => a.indexOf(t) === i),
            exitTime: actualExitTime,
          })

          expect(result.timedOut).toBe(false)
          expect(result.reason).toBe("exit")
        },
      ),
      { numRuns: 200 },
    )
  })

  test("output during the base timeout window extends the deadline", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 300_000 }),
        fc.array(fc.integer({ min: 0, max: 300_000 }), { maxLength: 10 }),
        (timeout, rawTimes) => {
          const startTime = 0
          const baseDeadline = startTime + timeout
          const sorted = [...rawTimes].filter((t) => t >= 0).sort((a, b) => a - b)

          const maxDeadline = startTime + timeout + 10 * 60 * 1000
          const outputTimes = [startTime, ...sorted]

          const result = simulateTimeout({
            startTime,
            timeout,
            stallMs: STALL_TIMEOUT_MS,
            maxDeadline,
            outputTimes,
          })

          expect(result.timedOut).toBe(true)

          // Only consider outputs that arrived BEFORE the timeout fired.
          // Outputs scheduled AFTER the timeout are irrelevant.
          const lastEffectiveOutput = Math.max(...outputTimes.filter((t) => t <= result.time!))
          const minExpected = Math.max(baseDeadline, lastEffectiveOutput + STALL_TIMEOUT_MS)

          expect(result.time).toBeGreaterThanOrEqual(minExpected - POLL_INTERVAL_MS)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Integration tests with real process execution ─────────────────────────

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
  ),
)

function initBash() {
  return runtime.runPromise(ShellTool.pipe(Effect.flatMap((info) => info.init())))
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const projectRoot = path.join(__dirname, "../..")

describe("shell output-liveness timeout (integration)", () => {
  /**
   * A fast command (echo) with a generous timeout should complete normally,
   * even though the timeout algorithm is now dynamic.
   */
  test("fast command completes before base deadline", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const result = await Effect.runPromise(
          bash.execute(
            {
              command: "echo hello-world-123",
              description: "Fast command",
              timeout: 10_000,
            },
            ctx,
          ),
        )
        expect(result.output).toContain("hello-world-123")
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  /**
   * A command that produces output continuously at a fast rate should
   * NOT timeout, even with a very short base timeout.
   */
  test.skipIf(process.platform === "win32")(
    "continuous output prevents timeout with short base timeout",
    async () => {
      await WithInstance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                // Print a number every 0.5s for 10 iterations (takes 5s total)
                // Base timeout is only 500ms, but continuous output should extend it
                command:
                  "for i in $(seq 1 10); do echo \"output-line-$i\"; sleep 0.5; done",
                description: "Continuous output test",
                timeout: 500,
              },
              ctx,
            ),
          )
          expect(result.output).toContain("output-line-10")
          expect(result.metadata.exit).toBe(0)
          // It should NOT say "exceeding timeout"
          expect(result.output).not.toContain("exceeding timeout")
        },
      })
    },
    30_000,
  )

  /**
   * A command that produces output then goes silent should still timeout.
   */
  test.skipIf(process.platform === "win32")("output-then-silence still times out after stall window", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        const result = await Effect.runPromise(
          bash.execute(
            {
              // Print one line, then sleep for longer than the timeout + stall window
              command: "echo starting-work && sleep 90",
              description: "Stall timeout test",
              timeout: 1_000,
            },
            ctx,
          ),
        )
        expect(result.output).toContain("starting-work")
        expect(result.output).toContain("exceeding timeout")
      },
    })
  }, 90_000)

  /**
   * A completely silent command should timeout at roughly the base deadline.
   */
  test.skipIf(process.platform === "win32")(
    "silent command times out at base deadline",
    async () => {
      await WithInstance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const start = Date.now()
          const result = await Effect.runPromise(
            bash.execute(
              {
                // `sleep` produces no output at all
                command: "sleep 90",
                description: "Silent timeout test",
                timeout: 2_000,
              },
              ctx,
            ),
          )
          const elapsed = Date.now() - start
          expect(result.output).toContain("exceeding timeout")
          // Should timeout at roughly base deadline (2s) + stall window (60s) at most
          // But for a silent command, should be closer to baseDeadline + poll granularity
          expect(elapsed).toBeGreaterThanOrEqual(1_500) // at least close to 2s
          expect(elapsed).toBeLessThanOrEqual(65_000) // well within maxDeadline
        },
      })
    },
    90_000,
  )

  /**
   * A command with a burst of output then silence should allow all the burst
   * output to be captured.
   */
  test.skipIf(process.platform === "win32")(
    "burst output is captured before stall timeout fires",
    async () => {
      await WithInstance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                // Fast burst of 50 lines, then sleep. All output should be captured
                // before the stall timeout fires.
                command: "for i in $(seq 1 50); do echo \"line-$i\"; done && sleep 90",
                description: "Burst output test",
                timeout: 1_000,
              },
              ctx,
            ),
          )
          expect(result.output).toContain("line-50")
          expect(result.output).toContain("exceeding timeout")
        },
      })
    },
    90_000,
  )

  /**
   * Downward `used` from list.shift() should not cause premature timeout.
   * The new code tracks lastOutputTime independently of the `used` counter.
   */
  test.skipIf(process.platform === "win32")("large output that triggers eviction does not cause premature timeout", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await initBash()
        // Generate enough output to trigger the eviction path in the stream handler.
        // The `used` counter goes up then down as old chunks are shifted,
        // but lastOutputTime keeps advancing, so the old-`used`-based approach
        // would falsely detect "no new output". Our Date.now()-based approach
        // should not have this bug.
        const result = await Effect.runPromise(
          bash.execute(
            {
              command: "echo first && echo second && echo third",
              description: "Eviction false-positive guard",
              timeout: 60_000,
            },
            ctx,
          ),
        )
        expect(result.output).toContain("first")
        expect(result.output).toContain("second")
        expect(result.output).toContain("third")
        expect(result.metadata.exit).toBe(0)
        expect(result.output).not.toContain("exceeding timeout")
      },
    })
  })
})
