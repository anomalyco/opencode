import type { SessionInfo } from "@opencode/client/promise"
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { ServerCtx } from "@/runtime/server/runtime"
import { pathKey } from "@/workspaces/path-key"
import {
  INITIAL_BRANCH_STATE,
  selectBranchLoading,
  transitionBranch,
  type BranchEffect,
  type BranchEvent,
} from "./branch-machine"

type Entry = { server: string; ctx: ServerCtx; session: SessionInfo }

export function createSessionBranches(connected: Accessor<readonly string[]>) {
  // Git info is not stored on the session, so load it for the rows a view shows. `branchTargets` keeps the latest row
  // per location for the lookup; the machine owns each location's phase.
  const [branchState, setBranchState] = createSignal(INITIAL_BRANCH_STATE)
  const branchTargets = new Map<string, Entry>()
  const branchTimers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatchBranch = (event: BranchEvent) =>
    untrack(() => {
      const previous = branchState()
      const next = transitionBranch(previous, event)

      if (next.state !== previous) setBranchState(next.state)
      next.effects.forEach(runBranchEffect)
    })

  const runBranchEffect = (effect: BranchEffect) => {
    if (effect.type === "timers.clear") {
      branchTimers.forEach(clearTimeout)
      branchTimers.clear()
      branchTargets.clear()

      return
    }

    if (effect.type === "timer.clear") {
      clearTimeout(branchTimers.get(effect.attempt))
      branchTimers.delete(effect.attempt)

      return
    }

    if (effect.type === "retry.schedule") {
      branchTimers.set(
        effect.attempt,
        setTimeout(() => {
          branchTimers.delete(effect.attempt)
          dispatchBranch({ type: "retry.due", key: effect.key, attempt: effect.attempt })
        }, effect.delayMs),
      )

      return
    }

    branchTimers.set(
      effect.attempt,
      setTimeout(() => {
        branchTimers.delete(effect.attempt)
        dispatchBranch({ type: "load.timed-out", key: effect.key, attempt: effect.attempt })
      }, effect.timeoutMs),
    )
    // A synchronous throw rejects too, so every attempt settles into an event.
    void Promise.try(() => {
      const entry = branchTargets.get(effect.key)

      if (!entry) throw new Error(`No session row for location ${effect.key}`)
      const location = entry.ctx.data.location

      return (
        location.info(entry.session.location) ? Promise.resolve() : location.syncInfo(entry.session.location)
      ).then(() => location.vcs.sync(entry.session.location))
    }).then(
      () => dispatchBranch({ type: "load.succeeded", key: effect.key, attempt: effect.attempt }),
      () => dispatchBranch({ type: "load.failed", key: effect.key, attempt: effect.attempt }),
    )
  }

  createEffect(() =>
    dispatchBranch({
      type: "connections.changed",
      connected: connected(),
    }),
  )

  onCleanup(() => dispatchBranch({ type: "disposed" }))

  const loadBranches = (list: Entry[]) => {
    list.forEach((entry) => branchTargets.set(locationKey(entry), entry))
    dispatchBranch({
      type: "enqueue",
      targets: list.map((entry) => ({ key: locationKey(entry), server: entry.server })),
    })
  }

  return {
    load: loadBranches,
    loading: (entry: Entry) =>
      !entry.ctx.data.location.vcs.info(entry.session.location) &&
      selectBranchLoading(branchState(), locationKey(entry)),
    branch: (entry: Entry) => entry.ctx.data.location.vcs.info(entry.session.location)?.branch.current ?? undefined,
  }
}

function locationKey(entry: Entry) {
  return `${entry.server}\0${pathKey(entry.session.location.directory)}`
}
