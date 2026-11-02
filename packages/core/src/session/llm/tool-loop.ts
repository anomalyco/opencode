/**
 * Cross-step tool-call loop detector.
 *
 * A model can loop across steps: one short reasoning block and one identical
 * tool call per step, each step a separate assistant message. Per-message checks
 * only see the calls inside one message, so they miss that shape. This detector
 * keeps the last `threshold` tool calls for the session (across steps, reset
 * only on a new user turn) and fires when they are all the same tool with the
 * same input.
 *
 * The loop can also alternate two identical calls (A, B, A, B, ...), one pair
 * per step. The period-1 rule never sees three identical calls in a row, so the
 * detector also fires on a short cycle of period 2..`TOOL_LOOP_MAX_PERIOD`
 * repeated `TOOL_LOOP_CYCLE_COPIES` times.
 *
 * The caller treats a hit as a soft interrupt: the repeated call is failed and
 * the turn continues with a nudge.
 */

export const TOOL_LOOP_THRESHOLD = 3

/** Longest alternating cycle the detector recognises. */
export const TOOL_LOOP_MAX_PERIOD = 4

/**
 * Copies of a period-2..4 cycle required to fire. Four copies of a two-call
 * cycle is eight calls, twice the period-1 threshold, so a legitimate
 * read/edit/read/edit rhythm is not cut short.
 */
export const TOOL_LOOP_CYCLE_COPIES = 4

/**
 * Copies required for a cycle of `period` calls. A pair needs four copies (eight
 * calls) so a legitimate read/edit rhythm survives; a triple or quadruple needs
 * only three (nine/twelve calls), because the key includes the input, so a real
 * "read/edit/test on A, then B, then C" has different inputs each cycle and
 * never matches anyway.
 */
export function toolLoopCycleCopies(period: number) {
  return period === 2 ? TOOL_LOOP_CYCLE_COPIES : TOOL_LOOP_CYCLE_COPIES - 1
}

export const TOOL_LOOP_NUDGE = "Your previous steps repeated the same tool call with identical input and were stopped."

/**
 * Loop nudges allowed per user turn (mid-stream and out-of-budget nudges both
 * count). The next detector hit in the same turn ends the turn with
 * `LOOP_ABORT_MESSAGE` instead of nudging again.
 */
export const LOOP_NUDGE_CAP = 2

export const LOOP_ABORT_MESSAGE =
  "loop_abort: the model kept repeating itself after 2 loop nudges this turn, so the turn was ended. Send a new message to continue."

export const TOOL_LOOP_NUDGE_TEXT = [
  TOOL_LOOP_NUDGE,
  "",
  "The repeated call was removed. Do not call it again; use the result you already have and take the next concrete step (make a different tool call / write the answer).",
].join("\n")

/**
 * Kill switch for the cross-step tool-call rule. Default ON;
 * `OPENCODE_TOOL_LOOP_DETECT=0` (or `false`/`off`/`no`) turns it off for new
 * sessions.
 */
export function toolLoopEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.OPENCODE_TOOL_LOOP_DETECT?.trim().toLowerCase()
  return !(value === "0" || value === "false" || value === "off" || value === "no")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** JSON with object keys sorted, so semantically identical inputs compare equal. */
function stable(value: unknown): string {
  if (!isRecord(value)) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    return JSON.stringify(value) ?? "null"
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`
}

export function toolCallKey(tool: string, input: unknown) {
  return `${tool}\u0000${stable(input)}`
}

export function toolCallLoopDetector(threshold = TOOL_LOOP_THRESHOLD) {
  const limit = Math.max(threshold, TOOL_LOOP_MAX_PERIOD * TOOL_LOOP_CYCLE_COPIES)
  let keys: string[] = []
  // True when the last `period * copies` calls are exactly `copies` repeats of
  // the same `period`-call block.
  const repeats = (period: number, copies: number) => {
    const span = period * copies
    if (keys.length < span) return false
    const tail = keys.slice(-span)
    for (let i = period; i < span; i++) if (tail[i] !== tail[i % period]) return false
    return true
  }
  return {
    /**
     * Feed the next tool call. Returns true when the last `threshold` calls are
     * identical (period 1) or the last `TOOL_LOOP_CYCLE_COPIES` blocks of a
     * period-2..`TOOL_LOOP_MAX_PERIOD` cycle are identical.
     */
    feed(tool: string, input: unknown): boolean {
      keys.push(toolCallKey(tool, input))
      if (keys.length > limit) keys.shift()
      if (repeats(1, threshold)) return true
      for (let period = 2; period <= TOOL_LOOP_MAX_PERIOD; period++)
        if (repeats(period, toolLoopCycleCopies(period))) return true
      return false
    },
    reset() {
      keys = []
    },
    get size() {
      return keys.length
    },
  }
}
