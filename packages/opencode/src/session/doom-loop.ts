export const MAX_PERIOD = 10

export interface Detector {
  readonly check: (tool: string, input: Record<string, unknown>) => boolean
}

export function create(): Detector {
  const capacity = 2 * MAX_PERIOD + 1
  const signatures = Array.from({ length: capacity }, () => "")
  const streaks = Array.from({ length: MAX_PERIOD + 1 }, () => 0)
  let next = 0
  let size = 0

  function latest(offset: number) {
    return signatures[(next - 1 - offset + capacity) % capacity]
  }

  return {
    check(tool, input) {
      signatures[next] = JSON.stringify([tool, input])
      next = (next + 1) % capacity
      size = Math.min(size + 1, capacity)

      let detected = false
      for (let period = 1; period <= MAX_PERIOD; period++) {
        const same = size > 2 * period && latest(0) === latest(period) && latest(0) === latest(2 * period)
        // A streak of p matching triples proves three equal length-p suffix blocks.
        streaks[period] = same ? Math.min(streaks[period] + 1, period) : 0
        if (streaks[period] === period) detected = true
      }
      return detected
    },
  }
}

export * as DoomLoop from "./doom-loop"
