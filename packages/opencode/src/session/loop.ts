export type LoopOutcome = {
  type: "loop"
  period: number
  source: "reasoning" | "text"
}

export const DEFAULTS = {
  min_period: 10,
  max_period: 2000,
  similarity: 1.0,
  check_interval: 100,
  min_chars: 200,
  max_nudges: 1,
} as const

const REMINDER =
  "<system-reminder>\nYour output is repeating in a loop with period ~{period} characters. Stop repeating and take a different, concrete action.\n</system-reminder>"

// Unicode letter-or-digit check: segments consisting entirely of punctuation,
// whitespace, or symbols are filtered as false positives. This handles non-Latin
// text (CJK, Arabic, etc.) while rejecting structural patterns like "---" or "| --- |".
const ALPHANUMERIC = /[\p{L}\p{N}]/u

function hasAlphanumeric(text: string) {
  return ALPHANUMERIC.test(text)
}

// Collapse runs of whitespace to a single space and trim. LLM outputs vary in
// whitespace between otherwise identical repetitions (extra newlines, trailing
// spaces, indentation drift), so normalization prevents missed detections.
function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function similarity(first: string, second: string, threshold: number) {
  const length = Math.max(first.length, second.length)
  if (length === 0) return 1.0

  // If lengths differ by more than the tolerance budget, reject early
  if (Math.abs(first.length - second.length) > (1 - threshold) * length) return 0

  let matches = 0
  const shorter = Math.min(first.length, second.length)

  for (let i = 0; i < shorter; i++) {
    if (first[i] === second[i]) matches++
  }

  return matches / length
}

export function isLoopOutcome(value: unknown): value is LoopOutcome {
  return typeof value === "object" && value !== null && (value as LoopOutcome).type === "loop"
}

export function recovery(
  attempt: number,
  options?: { max_nudges?: number; reminder?: string; period?: number },
): { action: "nudge"; reminder: string } | { action: "abort"; period: number; attempts: number } {
  const nudges = options?.max_nudges ?? DEFAULTS.max_nudges
  const period = options?.period ?? 0

  if (attempt < nudges) {
    const template = options?.reminder ?? REMINDER
    return { action: "nudge", reminder: template.replace("{period}", String(period)) }
  }

  return { action: "abort", period, attempts: attempt + 1 }
}

export function create(options: {
  source: "reasoning" | "text"
  min_period?: number
  max_period?: number
  similarity?: number
  check_interval?: number
  min_chars?: number
  on_detected?: (outcome: LoopOutcome) => void
}) {
  const minPeriod = options.min_period ?? DEFAULTS.min_period
  const maxPeriod = options.max_period ?? DEFAULTS.max_period
  const threshold = options.similarity ?? DEFAULTS.similarity
  const interval = options.check_interval ?? DEFAULTS.check_interval
  const minChars = options.min_chars ?? DEFAULTS.min_chars
  const capacity = 2 * maxPeriod
  const source = options.source

  let buffer = ""
  let total = 0
  let last = 0

  function detect(): LoopOutcome | undefined {
    const length = buffer.length
    if (length < 2 * minPeriod) return undefined

    // Scan from longest candidate period down to shortest. Longer periods are
    // checked first so we report the most meaningful repeating unit.
    const upper = Math.min(Math.floor(length / 2), maxPeriod)
    const lower = minPeriod

    for (let period = upper; period >= lower; period--) {
      // Two-position spot-check fast path: compare the last character of the
      // buffer against the character one period earlier, and the midpoint of
      // the second segment against the midpoint of the first. Two independent
      // checks at different offsets give a false-pass probability of roughly
      // 1/(alphabet_size^2), rejecting ~99.95% of non-repeating periods in O(1).
      const tail = length - 1
      const mid = length - 1 - Math.floor(period / 2)
      if (buffer[tail] !== buffer[tail - period]) continue
      if (buffer[mid] !== buffer[mid - period]) continue

      // Full normalized comparison: extract two adjacent segments of length period,
      // normalize whitespace, then compare.
      const first = normalize(buffer.slice(length - 2 * period, length - period))
      const second = normalize(buffer.slice(length - period))

      const score = threshold >= 1.0 ? (first === second ? 1.0 : 0) : similarity(first, second, threshold)
      if (score < threshold) continue

      // Alphanumeric false-positive filter: reject segments that contain no
      // Unicode letters or digits. This filters structural patterns like
      // markdown separators ("---"), bullet markers, and ASCII art without
      // needing brittle pattern-specific rules.
      if (!ALPHANUMERIC.test(second)) continue

      const outcome: LoopOutcome = { type: "loop", period, source }
      options.on_detected?.(outcome)
      return outcome
    }

    return undefined
  }

  return {
    feed(delta: string): LoopOutcome | undefined {
      buffer += delta
      total += delta.length

      // Keep buffer bounded to 2 * max_period
      if (buffer.length > capacity) buffer = buffer.slice(buffer.length - capacity)

      if (total < minChars) return undefined
      if (total - last < interval) return undefined

      last = total
      return detect()
    },

    reset() {
      buffer = ""
      total = 0
      last = 0
    },
  }
}
