import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "@opencode-ai/ui/context/i18n"

export function createThinkingLabel(props: { active: boolean; start?: number; end?: number; fallbackEnd?: number }) {
  const i18n = useI18n()
  const [clock, setClock] = createStore({
    now: Date.now(),
    start: Date.now(),
    stopped: props.active ? undefined : (props.end ?? props.fallbackEnd ?? props.start),
  })
  createEffect(() => {
    const active = props.active
    const start = props.start
    setClock({ now: Date.now(), start: start ?? Date.now() })
    if (!active) {
      setClock("stopped", (value) => value ?? Date.now())
      return
    }
    setClock("stopped", undefined)
    const timer = setInterval(() => setClock("now", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return createMemo(() => {
    const seconds = Math.max(
      0,
      Math.round(((props.end ?? clock.stopped ?? clock.now) - (props.start ?? clock.start)) / 1000),
    )
    const duration =
      seconds < 60
        ? i18n.t("ui.message.duration.seconds", { count: seconds })
        : i18n.t("ui.message.duration.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
    return i18n.t(props.active ? "ui.sessionTurn.status.thinkingFor" : "ui.sessionTurn.status.thoughtFor", {
      duration,
    })
  })
}
