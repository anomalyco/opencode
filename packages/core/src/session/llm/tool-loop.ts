/**
 * Cross-step tool-call loop detector (2026-10-31).
 *
 * The reasoning-loop detector (LD-05) is scoped to one step: it is reset on
 * every `step-start`, so it only sees repetition *inside* a single reasoning
 * block. The `doom_loop` permission check is scoped to one assistant message:
 * it looks at `parts.slice(-3)`, so it only sees three identical tool parts in
 * the same message.
 *
 * A model can loop across steps instead: one short reasoning block and one
 * identical tool call per step, each step a separate assistant message. Both
 * existing breakers miss that shape. This detector keeps the last `threshold`
 * tool calls for the session (across steps, reset only on a new user turn) and
 * fires when they are all the same tool with the same input.
 *
 * LD-05f (2026-11-01): the loop can also ALTERNATE two identical calls
 * (A, B, A, B, ...), one pair per step. The period-1 rule never sees three
 * identical calls in a row, so it missed the "Next-gen dgxraid" session
 * (ses_e6aeb8219ffeL4QLYM183cVgbu): 176 identical steps of the same two bash
 * commands, 1.0M-token context, 3.2 MB prompt. The detector now also fires on
 * a short cycle of period 2..`TOOL_LOOP_MAX_PERIOD` repeated
 * `TOOL_LOOP_CYCLE_COPIES` times. See v2/analysis/LOOP-ANALYSIS-2026-11-01.md.
 *
 * The caller treats a hit as a SOFT interrupt (nudge + continue), the same
 * path as the reasoning loop.
 */

export const TOOL_LOOP_THRESHOLD = 3

/** Longest alternating cycle the detector recognises (LD-05f). */
export const TOOL_LOOP_MAX_PERIOD = 4

/**
 * Copies of a period-2..4 cycle required to fire (LD-05f). Four copies of a
 * two-call cycle is eight calls, twice the period-1 threshold, so a legitimate
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
     * period-2..`TOOL_LOOP_MAX_PERIOD` cycle are identical (LD-05f).
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
