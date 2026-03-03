import { Log } from "@/util/log"

const log = Log.create({ service: "session.thinking-loop" })

const DETECTOR_DEFAULTS = {
  min_period: 80,
  max_period: 800,
  check_interval: 100,
  raw_buffer_size: 3000,
  min_chars_before_detection: 500,
  min_unique_chars: 20,
} as const

const RECOVERY_DEFAULTS = {
  max_nudges: 1,
  max_compacts: 1,
} as const

const DEFAULT_REMINDER =
  "Your reasoning output is repeating in a loop (~{period} chars). Stop repeating and immediately do the next concrete step: make a tool call or provide your final answer."

export type ThinkingLoopOutcome = {
  type: "thinking_loop"
  period: number
}

export type ThinkingLoopConfig = {
  enabled?: boolean
  min_period?: number
  max_period?: number
  check_interval?: number
  min_chars_before_detection?: number
  min_unique_chars?: number
  max_nudges?: number
  max_compacts?: number
  reminder_template?: string
}

export type ThinkingLoopDetectorOptions = {
  min_period?: number
  max_period?: number
  check_interval?: number
  raw_buffer_size?: number
  min_chars_before_detection?: number
  min_unique_chars?: number
  on_loop_detected?: (info: { period: number; sample: string }) => void
}

export type RecoveryOptions = {
  max_nudges?: number
  max_compacts?: number
  reminder_template?: string
}

export type RecoveryAction =
  | { type: "nudge"; reminder: string }
  | { type: "compact" }
  | { type: "abort"; period: number; attempts: number }

function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

function uniqueChars(input: string) {
  return new Set(input).size
}

function hasAlphaNumeric(input: string) {
  return /[A-Za-z0-9]/.test(input)
}

export function isThinkingLoopOutcome(input: unknown): input is ThinkingLoopOutcome {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.hasOwn(input, "type") &&
    (input as ThinkingLoopOutcome).type === "thinking_loop"
  )
}

export class ThinkingLoopDetector {
  private raw = ""
  private total = 0
  private since = 0
  private detected = false
  private period = 0
  private min_period: number
  private max_period: number
  private check_interval: number
  private raw_buffer_size: number
  private min_chars_before_detection: number
  private min_unique_chars: number
  private on_loop_detected?: ThinkingLoopDetectorOptions["on_loop_detected"]

  constructor(options: ThinkingLoopDetectorOptions = {}) {
    this.min_period = options.min_period ?? DETECTOR_DEFAULTS.min_period
    this.max_period = options.max_period ?? DETECTOR_DEFAULTS.max_period
    if (this.min_period > this.max_period) {
      throw new Error(`min_period (${this.min_period}) must be <= max_period (${this.max_period})`)
    }
    this.check_interval = options.check_interval ?? DETECTOR_DEFAULTS.check_interval
    this.min_chars_before_detection = options.min_chars_before_detection ?? DETECTOR_DEFAULTS.min_chars_before_detection
    this.min_unique_chars = options.min_unique_chars ?? DETECTOR_DEFAULTS.min_unique_chars
    const minBufferSize = this.max_period * 3 + 1
    if (options.raw_buffer_size && options.raw_buffer_size < minBufferSize) {
      log.warn("raw_buffer_size too small, using minimum", {
        raw_buffer_size: options.raw_buffer_size,
        max_period: this.max_period,
        minimum: minBufferSize,
      })
    }
    this.raw_buffer_size = Math.max(options.raw_buffer_size ?? DETECTOR_DEFAULTS.raw_buffer_size, minBufferSize)
    this.on_loop_detected = options.on_loop_detected
  }

  feed(delta: string): ThinkingLoopOutcome | undefined {
    if (this.detected) return { type: "thinking_loop", period: this.period }

    this.total += delta.length
    this.since += delta.length
    this.raw += delta

    if (this.raw.length > this.raw_buffer_size) {
      this.raw = this.raw.slice(-this.raw_buffer_size)
    }

    if (this.total < this.min_chars_before_detection) return
    if (this.since < this.check_interval) return
    this.since = 0

    return this.checkForLoop()
  }

  private checkForLoop(): ThinkingLoopOutcome | undefined {
    const bufferLength = this.raw.length
    // To detect a period of p, we need at least 3*p characters (for 3 consecutive occurrences)
    const maxDetectablePeriod = Math.min(this.max_period, Math.floor(bufferLength / 3))

    // Check each possible period from largest to smallest (prefer detecting longer periods)
    for (let period = maxDetectablePeriod; period >= this.min_period; period--) {
      if (this.hasRepeatingPattern(period)) {
        this.detected = true
        this.period = period
        const sample = this.getNormalizedSample(period)
        this.on_loop_detected?.({ period, sample })
        return { type: "thinking_loop", period }
      }
    }
  }

  // Fast path: check end characters before doing full string comparison
  // If the pattern repeats, the last char should equal the char at -period and -2*period
  private hasRepeatingPattern(period: number): boolean {
    const end = this.raw.length - 1
    if (this.raw[end] !== this.raw[end - period]) return false
    if (this.raw[end] !== this.raw[end - period * 2]) return false
    if (this.raw[end - period + 1] !== this.raw[end - period * 2 + 1]) return false

    return this.matchesNormalizedPattern(period)
  }

  // Compare 3 consecutive segments of length 'period' after whitespace normalization
  private matchesNormalizedPattern(period: number): boolean {
    const end = this.raw.length
    const first = normalizeWhitespace(this.raw.slice(end - period * 3, end - period * 2))
    const second = normalizeWhitespace(this.raw.slice(end - period * 2, end - period))
    const third = normalizeWhitespace(this.raw.slice(end - period, end))

    if (!first || first !== second || second !== third) return false
    if (!hasAlphaNumeric(third)) return false
    if (uniqueChars(third) < this.min_unique_chars) return false

    return true
  }

  private getNormalizedSample(period: number): string {
    const end = this.raw.length
    const sample = this.raw.slice(end - period, end)
    return normalizeWhitespace(sample).slice(0, 100)
  }

  reset() {
    this.raw = ""
    this.total = 0
    this.since = 0
    this.detected = false
    this.period = 0
  }
}

export function getRecoveryAction(attempt: number, period: number, options: RecoveryOptions = {}): RecoveryAction {
  const nudges = options.max_nudges ?? RECOVERY_DEFAULTS.max_nudges
  const compacts = options.max_compacts ?? RECOVERY_DEFAULTS.max_compacts
  const template = options.reminder_template ?? DEFAULT_REMINDER

  if (attempt < nudges) {
    return {
      type: "nudge",
      reminder: template.replaceAll("{period}", `${period}`),
    }
  }

  if (attempt < nudges + compacts) {
    return { type: "compact" }
  }

  return {
    type: "abort",
    period,
    attempts: attempt + 1,
  }
}
