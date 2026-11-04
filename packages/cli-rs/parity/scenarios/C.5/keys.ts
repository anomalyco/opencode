// Keys and a step helper for the C.5 and C.6 P-PTY scenarios.
import type { PtyStep } from "../../pty/run"

export const down = "\x1b[B"
export const right = "\x1b[C"
export const enter = "\r"
export const escape = "\x1b"
export const space = " "

// Keys, then a checkpoint once the screen shows `until` (when given) and has settled.
export function press(keys: string, checkpoint: string, until?: string): PtyStep {
  return { keys, until: until === undefined ? undefined : { screen: until }, settle: 300, checkpoint }
}

// The first frame: the command starts, connects, and draws its first prompt.
export function first(until: string, checkpoint: string): PtyStep {
  return { until: { screen: until }, settle: 300, checkpoint, timeout: 30_000 }
}
