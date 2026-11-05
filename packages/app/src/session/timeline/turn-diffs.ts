import type { FileDiffInfo } from "@opencode/client/promise"
import type { TurnDiffInput } from "@opencode/session-ui/context"
import { createSignal, onCleanup, untrack } from "solid-js"
import {
  createTurnDiffCacheState,
  selectTurnDiffState,
  transitionTurnDiffCache,
  type TurnDiffCacheEffect,
  type TurnDiffCacheEvent,
} from "./turn-diff-machine"

type Fetch = (signal: AbortSignal) => Promise<readonly FileDiffInfo[]>

/**
 * One tab's in-memory cache of the files each finished turn changed. A finished turn's snapshots never change, so each
 * turn loads once per tab and survives the timeline remounting; a failed or timed-out load retries on request. Closing
 * the tab disposes its owner, which aborts the loads still running.
 */
export function createTurnDiffCache() {
  const [cacheState, setCacheState] = createSignal(createTurnDiffCacheState())
  const pending = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const key = (input: TurnDiffInput) => `${input.sessionID}/${input.from}`

  const dispatch = (event: TurnDiffCacheEvent, fetch?: Fetch) => {
    const result = transitionTurnDiffCache(untrack(cacheState), event)
    setCacheState(result.state)
    result.effects.forEach((effect) => run(effect, fetch))
  }

  const run = (effect: TurnDiffCacheEffect, fetch: Fetch | undefined) => {
    if (effect.type === "cancel") {
      const item = pending.get(effect.attempt)
      pending.delete(effect.attempt)
      clearTimeout(item?.timer)
      item?.controller.abort()

      return
    }

    if (!fetch) return
    const controller = new AbortController()
    const settle = (event: TurnDiffCacheEvent) => {
      if (!controller.signal.aborted) dispatch(event)
    }

    pending.set(effect.attempt, {
      controller,
      timer: setTimeout(
        () => settle({ type: "load.timed-out", key: effect.key, attempt: effect.attempt }),
        effect.timeoutMs,
      ),
    })
    // `Promise.try` turns a synchronous throw into a rejection, so it fails the attempt rather than leaving it loading.
    void Promise.try(() => fetch(controller.signal)).then(
      (diffs) => settle({ type: "load.succeeded", key: effect.key, attempt: effect.attempt, diffs }),
      () => settle({ type: "load.failed", key: effect.key, attempt: effect.attempt }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    state: (input: TurnDiffInput) => selectTurnDiffState(cacheState(), key(input)),
    load: (input: TurnDiffInput, fetch: Fetch) => dispatch({ type: "load.requested", key: key(input) }, fetch),
  }
}
