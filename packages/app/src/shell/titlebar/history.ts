import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import {
  INITIAL_TITLEBAR_HISTORY_STATE,
  transitionTitlebarHistory,
  type TitlebarHistoryEffect,
  type TitlebarHistoryEvent,
} from "./history-machine"

/** The titlebar's own Back and Forward history, across tab switches and in-app navigation. */
export function createTitlebarHistory() {
  const navigate = useNavigate()
  const location = useLocation()
  const [historyState, setHistoryState] = createSignal(INITIAL_TITLEBAR_HISTORY_STATE)
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const path = () => `${location.pathname}${location.search}${location.hash}`

  const dispatch = (event: TitlebarHistoryEvent) => {
    const result = transitionTitlebarHistory(untrack(historyState), event)
    setHistoryState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: TitlebarHistoryEffect) => {
    clearTimeout(settleTimer)
    settleTimer = undefined

    if (effect.type === "timer.clear") return
    settleTimer = setTimeout(
      () => dispatch({ type: "traverse.timed-out", attempt: effect.attempt, currentUrl: untrack(path) }),
      effect.timeoutMs,
    )
    navigate(effect.to.url, { state: effect.to.state })
  }

  createEffect(() => {
    const current = { url: path(), state: location.state }
    untrack(() => dispatch({ type: "location.changed", current }))
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    back: () => dispatch({ type: "back" }),
    forward: () => dispatch({ type: "forward" }),
  }
}
