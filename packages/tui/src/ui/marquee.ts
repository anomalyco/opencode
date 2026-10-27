import { createSignal, onCleanup } from "solid-js"
import { createAnimatable, tween } from "./animation"
import { marqueeCycleWidth, marqueeOverflows } from "../util/marquee"

const MARQUEE_DELAY = 600
const MARQUEE_INTERVAL = 80

export function createMarquee(animations: () => boolean) {
  const [offset, setOffset] = createSignal(0)
  const [active, setActive] = createSignal<string>()
  const leading = createAnimatable({ opacity: 0 }, { enabled: animations, transition: tween({ duration: 0.25 }) })
  let delay: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let cycleWidth = 0

  const clear = () => {
    if (delay) clearTimeout(delay)
    if (interval) clearInterval(interval)
    delay = undefined
    interval = undefined
  }
  const scroll = () => {
    interval = setInterval(
      () =>
        setOffset((value) => {
          if (value + 1 < cycleWidth) return value + 1
          clear()
          leading.animate({ opacity: 0 })
          return 0
        }),
      MARQUEE_INTERVAL,
    )
  }
  const enter = (id: string, text: string, width: number) => {
    if (!marqueeOverflows(text, width)) {
      reset()
      return
    }
    if (active() === id) return
    clear()
    cycleWidth = marqueeCycleWidth(text)
    setActive(id)
    setOffset(0)
    leading.jump({ opacity: 0 })
    delay = setTimeout(() => {
      setOffset(1)
      leading.animate({ opacity: 1 })
      scroll()
    }, MARQUEE_DELAY)
  }
  const leave = (id: string) => {
    if (active() !== id) return
    reset()
  }
  const reset = () => {
    clear()
    setActive(undefined)
    setOffset(0)
    leading.jump({ opacity: 0 })
  }
  onCleanup(clear)

  return { offset, active, enter, leave, reset, leading: () => leading.value().opacity }
}
