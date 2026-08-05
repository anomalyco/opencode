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
  /** Auto is the only mode that drives the openspec backlog on its own. */
  queue: boolean
}

export const MODES: ModeSpec[] = [
  {
    value: "manual",
    title: "Manual",
    footer: "Asks before risky tools. Stops at the end of every turn.",
    auto_mode: false,
    auto_continue: false,
    queue: false,
  },
  {
    value: "skip-ask",
    title: "Skip-ask",
    footer: "Approves prompts that would have asked. Still stops at the end of every turn.",
    auto_mode: true,
    auto_continue: false,
    queue: false,
  },
  {
    value: "continue",
    title: "Continue",
    footer: "Keeps working on your prompt after a turn, but still asks before risky tools.",
    auto_mode: false,
    auto_continue: true,
    queue: false,
  },
  {
    value: "auto",
    title: "Auto",
    footer: "Works the openspec backlog change by change, never asks, never pushes. Deny rules still hold.",
    auto_mode: true,
    auto_continue: true,
    queue: true,
  },
]

export function currentAutoMode(auto_mode: boolean, auto_continue: boolean): ModeValue {
  if (auto_mode && auto_continue) return "auto"
  if (auto_mode) return "skip-ask"
  if (auto_continue) return "continue"
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
  if (modeSpec(input.mode).queue) {
    // Already working the backlog — selecting Auto again must not stack a
    // second run over the same working tree.
    if (live.length > 0) return { stopped: 0 }
    return { started: await input.start(), stopped: 0 }
  }
  for (const run of live) await input.cancel(run.id)
  return { stopped: live.length }
}
