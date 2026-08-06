import type { Loop } from "@opencode-ai/sdk/v2"

// Auto mode is three things the user thinks of as one: don't ask me for
// permission, don't stop at the end of a turn, and work the backlog rather
// than waiting for me to name the next task. The first two are config flags;
// the third is a queue run. Keeping them in one place is what stops the
// indicator from claiming a level of autonomy the agent does not actually have.
export type ModeValue = "manual" | "skip-ask" | "continue" | "auto"

export interface ModeSpec {
  value: ModeValue
  title: string
  footer: string
  auto_mode: boolean
  auto_continue: boolean
  /** Auto is the only rung that takes work from the backlog on its own. */
  auto_queue: boolean
}

// A LADDER, not a matrix. Each rung is strictly more autonomous than the one
// above it, and every rung includes everything below it — so there is no
// combination to reason about, only "how far up".
//
// The previous shape was two independent switches, which produced a state that
// could not work: keep going after a turn, but still stop to ask permission.
// Unattended, that parks on the first prompt with nobody there to answer. It
// is gone: continuing implies not asking.
export const MODES: ModeSpec[] = [
  {
    value: "manual",
    title: "Manual — you drive",
    footer: "Asks before risky tools, and stops after every turn.",
    auto_mode: false,
    auto_continue: false,
    auto_queue: false,
  },
  {
    value: "skip-ask",
    title: "Skip-ask — no prompts, still stops",
    footer: "Approves what would have asked. Still stops after every turn, so you say what is next.",
    auto_mode: true,
    auto_continue: false,
    auto_queue: false,
  },
  {
    value: "continue",
    title: "Continue — keeps working on your prompt",
    footer: "No prompts, and keeps going on what you asked for until it is done. Does not touch the backlog.",
    auto_mode: true,
    auto_continue: true,
    auto_queue: false,
  },
  {
    value: "auto",
    title: "Auto — works the backlog unattended",
    footer: "No prompts, never stops: takes the next openspec change itself. Never pushes; deny rules still hold.",
    auto_mode: true,
    auto_continue: true,
    auto_queue: true,
  },
]

/**
 * Reads the ladder rung out of config. Tolerates the off-ladder combinations an
 * older config or a hand edit can contain by rounding to the nearest rung — the
 * indicator must always name something real.
 */
export function currentAutoMode(auto_mode: boolean, auto_continue: boolean, auto_queue = false): ModeValue {
  if (auto_queue) return "auto"
  if (auto_continue) return "continue"
  if (auto_mode) return "skip-ask"
  return "manual"
}

export function modeSpec(value: ModeValue): ModeSpec {
  return MODES.find((mode) => mode.value === value) ?? MODES[0]
}

const LIVE: Loop["status"][] = ["running", "paused"]

export function liveQueueRuns(loops: readonly Loop[]): Loop[] {
  return loops.filter((loop) => loop.mode === "queue" && LIVE.includes(loop.status))
}

/**
 * Brings the backlog runs in line with the selected mode.
 *
 * Auto starts one if none is running; anything else stops the ones that are.
 * Leaving a backlog run alive while the indicator reads "Manual" would be the
 * indicator lying about what the agent is doing — the failure this whole
 * surface exists to avoid. Stopping is cheap to undo: the queue cursor is
 * derived from the checkboxes on disk, so selecting Auto again resumes exactly
 * where it left off rather than redoing anything.
 */
export async function reconcileQueue(input: {
  mode: ModeValue
  list: () => Promise<readonly Loop[]>
  start: () => Promise<Loop | undefined>
  cancel: (loopID: string) => Promise<void>
}): Promise<{ started?: Loop; stopped: number }> {
  const live = liveQueueRuns(await input.list())
  if (modeSpec(input.mode).auto_queue) {
    // Already working the backlog — selecting Auto again must not stack a
    // second run over the same working tree.
    if (live.length > 0) return { stopped: 0 }
    return { started: await input.start(), stopped: 0 }
  }
  for (const run of live) await input.cancel(run.id)
  return { stopped: live.length }
}
