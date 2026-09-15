export * as Duration from "./duration"

import { Effect } from "effect"
import { CronError } from "./port"

const MIN_INTERVAL_MS = 60_000

const RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

export const parseDuration = (input: string): Effect.Effect<number, CronError> =>
  Effect.gen(function* () {
    const match = RE.exec(input)
    if (!match || (!match[1] && !match[2] && !match[3])) {
      return yield* new CronError({ message: `Invalid duration: "${input}". Use format like 5m, 1h, 2h30m, 90s.` })
    }
    const hours = match[1] ? parseInt(match[1], 10) : 0
    const minutes = match[2] ? parseInt(match[2], 10) : 0
    const seconds = match[3] ? parseInt(match[3], 10) : 0
    const ms = (hours * 3600 + minutes * 60 + seconds) * 1000
    if (!Number.isFinite(ms)) {
      return yield* new CronError({ message: `Interval too large: "${input}".` })
    }
    if (ms < MIN_INTERVAL_MS) {
      return yield* new CronError({ message: `Interval must be at least 1 minute (60s). Got: ${ms / 1000}s` })
    }
    return ms
  })
