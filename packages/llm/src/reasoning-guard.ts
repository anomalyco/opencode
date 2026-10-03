import { Stream } from "effect"
import { LLMEvent, type LLMError } from "./schema"

// Thresholds are conservative: legitimate reasoning never repeats one short
// line a dozen times in a row, nor cycles 24 segments with period <= 8. The
// window dominance bar is 18/30 (60%) so mixed loops dominated by one phrase
// (e.g. "好。" with occasional "嗯。"/"(写)") still trip while diverse
// reasoning stays far below it.
export const CONSECUTIVE_THRESHOLD = 12
export const WINDOW_SIZE = 30
export const WINDOW_MAX_DISTINCT = 5
export const WINDOW_MIN_DOMINANT = 18
export const CYCLE_WINDOW = 24
export const CYCLE_MAX_PERIOD = 8
export const CHAR_TAIL = 160
export const CHAR_MAX_PERIOD = 24
export const MAX_SUPPRESSED_DELTAS = 200
export const MAX_SUPPRESSED_CHARS = 8_000

export const GUARD_MESSAGE_PREFIX = "Degenerate repetitive reasoning stream detected"

// Split accumulated reasoning into comparable segments. Providers chunk
// deltas arbitrarily, so re-segment the full text each time. Sentence
// terminators are also boundaries so "好。好。好。" without newlines still
// yields ["好。", "好。", "好。"] instead of one long line.
export const splitReasoningSegments = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;…])/))
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

const hasConsecutiveLoop = (segments: ReadonlyArray<string>): boolean => {
  if (segments.length < CONSECUTIVE_THRESHOLD) return false
  const tail = segments.slice(-CONSECUTIVE_THRESHOLD)
  return tail.every((part) => part === tail[0])
}

const hasLowDiversityLoop = (segments: ReadonlyArray<string>): boolean => {
  if (segments.length < WINDOW_SIZE) return false
  const tail = segments.slice(-WINDOW_SIZE)
  const counts = new Map<string, number>()
  for (const part of tail) counts.set(part, (counts.get(part) ?? 0) + 1)
  if (counts.size > WINDOW_MAX_DISTINCT) return false
  return Math.max(...counts.values()) >= WINDOW_MIN_DOMINANT
}

const hasCyclicLoop = (segments: ReadonlyArray<string>): boolean => {
  if (segments.length < CYCLE_WINDOW) return false
  const tail = segments.slice(-CYCLE_WINDOW)
  for (let period = 1; period <= CYCLE_MAX_PERIOD; period++) {
    let matches = true
    for (let i = period; i < tail.length; i++) {
      if (tail[i] !== tail[i - period]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

// Char-level fallback for streams without line or sentence boundaries
// (e.g. "abcabcabc..."). Checks the tail satisfies s[j] === s[j-p] for some
// small period p, which is phase-independent unlike prefix repetition checks.
const hasRepeatedSubstringLoop = (text: string): boolean => {
  if (text.length < CHAR_TAIL) return false
  const tail = text.slice(-CHAR_TAIL)
  for (let period = 1; period <= CHAR_MAX_PERIOD; period++) {
    let matches = true
    for (let i = period; i < tail.length; i++) {
      if (tail[i] !== tail[i - period]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

// Pure detector over accumulated reasoning text. Only inspects the tail so
// each streaming check stays bounded instead of re-scanning from scratch.
export const isDegenerateReasoning = (text: string): boolean => {
  if (hasRepeatedSubstringLoop(text)) return true
  const segments = splitReasoningSegments(text)
  if (hasConsecutiveLoop(segments)) return true
  if (hasLowDiversityLoop(segments)) return true
  if (hasCyclicLoop(segments)) return true
  return false
}

export interface ReasoningGuard {
  readonly text: string
  readonly degenerate: boolean
  push(delta: string): ReasoningGuardResult
}

export interface ReasoningGuardResult {
  readonly degenerate: boolean
  readonly text: string
}

// Small stateful accumulator for callers that want push-based checks without
// owning the tail-slicing logic. The stream wrapper below is the primary
// consumer; tests use this directly for deterministic assertions.
export const createReasoningGuard = (): ReasoningGuard => {
  let text = ""
  let degenerate = false
  return {
    get text() {
      return text
    },
    get degenerate() {
      return degenerate
    },
    push(delta: string) {
      if (!degenerate) {
        text += delta
        degenerate = isDegenerateReasoning(text)
      }
      return { degenerate, text }
    },
  }
}

interface GuardState {
  readonly text: string
  readonly open: ReadonlyArray<string>
  readonly degenerate: boolean
  readonly suppressedDeltas: number
  readonly suppressedChars: number
  readonly terminated: boolean
}

const initialGuardState = (): GuardState => ({
  text: "",
  open: [],
  degenerate: false,
  suppressedDeltas: 0,
  suppressedChars: 0,
  terminated: false,
})

const guardTermination = (event: LLMEvent): boolean =>
  event.type === "provider-error" && event.message.startsWith(GUARD_MESSAGE_PREFIX)

const closeOpenReasoning = (open: ReadonlyArray<string>): LLMEvent[] =>
  open.map((id) => LLMEvent.reasoningEnd({ id }))

const guardMessage = (suppressedDeltas: number, suppressedChars: number) =>
  `${GUARD_MESSAGE_PREFIX} and truncated after ${suppressedDeltas} suppressed reasoning deltas (${suppressedChars} chars)`

const stepGuard = (state: GuardState, event: LLMEvent): readonly [GuardState, ReadonlyArray<LLMEvent>] => {
  if (state.terminated) return [state, []]
  if (event.type === "reasoning-start") {
    if (state.degenerate) return [state, []]
    if (state.open.includes(event.id)) return [state, [event]]
    return [{ ...state, open: [...state.open, event.id] }, [event]]
  }
  if (event.type === "reasoning-delta") {
    if (state.degenerate) {
      const suppressedDeltas = state.suppressedDeltas + 1
      const suppressedChars = state.suppressedChars + event.text.length
      if (suppressedDeltas > MAX_SUPPRESSED_DELTAS || suppressedChars > MAX_SUPPRESSED_CHARS) {
        const closes = closeOpenReasoning(state.open)
        const error = LLMEvent.providerError({ message: guardMessage(suppressedDeltas, suppressedChars) })
        return [{ ...state, open: [], suppressedDeltas, suppressedChars, terminated: true }, [...closes, error]]
      }
      return [{ ...state, suppressedDeltas, suppressedChars }, []]
    }
    const text = state.text + event.text
    if (!isDegenerateReasoning(text)) {
      const open = state.open.includes(event.id) ? state.open : [...state.open, event.id]
      return [{ ...state, text, open }, [event]]
    }
    // Drop the triggering delta to minimize persisted junk, then cleanly
    // conclude open reasoning blocks so downstream sees truncated reasoning
    // instead of a hanging open block. Non-reasoning events still flow so a
    // recovering provider can finish the turn; prolonged loops terminate via
    // the suppression budget above.
    const closes = closeOpenReasoning(
      state.open.includes(event.id) ? state.open : [...state.open, event.id],
    )
    return [{ ...state, text, open: [], degenerate: true, suppressedDeltas: 0, suppressedChars: 0 }, closes]
  }
  if (event.type === "reasoning-end") {
    if (state.degenerate) return [state, []]
    return [{ ...state, open: state.open.filter((id) => id !== event.id) }, [event]]
  }
  return [state, [event]]
}

// Truncate degenerate reasoning loops while letting the turn continue. The
// first degenerate delta is dropped and open reasoning blocks are concluded;
// further reasoning deltas are suppressed. Productive events (text, tools,
// natural finish) still pass through for recovery. Only a prolonged loop with
// no productive events terminates the stream with a provider-error.
export const guardReasoningStream = (
  stream: Stream.Stream<LLMEvent, LLMError>,
): Stream.Stream<LLMEvent, LLMError> =>
  stream.pipe(Stream.mapAccum(initialGuardState, stepGuard), Stream.takeUntil(guardTermination))

export * as ReasoningGuard from "./reasoning-guard"
