import { createEffect, type Accessor } from "solid-js"
import { useKV } from "@tui/context/kv"
import { useLeaderActive } from "../../keymap"
import type { StatusState } from "./state-machine"

const STATE_ORDINAL: Record<StatusState, number> = {
  idle: 0,
  running: 1,
  parallel: 1,
  retry: 1,
  retry_exhausted: 4,
  error: 4,
  complete: 0,
}

export function useOscProgress(input: {
  state: Accessor<StatusState>
  progress: Accessor<number>
}) {
  const kv = useKV()
  const leader = useLeaderActive()

  createEffect(() => {
    const animations = kv.get("animations_enabled", true)
    if (!animations) return
    if (!leader()) return
    const state = input.state()
    const progress = input.progress()
    const ordinal = STATE_ORDINAL[state]
    process.stdout.write(`\x1b]9;4;${ordinal};${progress}\x07`)
  })
}

export * as WorkflowOscProgress from "./osc-progress"