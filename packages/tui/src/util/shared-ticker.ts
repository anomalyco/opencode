import { createSignal, onCleanup } from "solid-js"

// Shared 1s ticker so Shell output, retry countdowns and the scripts tab do not
// each own a setInterval. Subscribers share one interval; when hidden the
// interval backs off to 5s to avoid waking the render loop.
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined
let hidden = false
const [tick, setTick] = createSignal(0)

function ensure() {
  if (timer !== undefined) return
  timer = setInterval(
    () => {
      if (hidden) return
      setTick((value) => value + 1)
    },
    1_000,
  )
  // Backoff is implicit: while hidden no tick is emitted, so dependents pause.
}

export function setTickerHidden(value: boolean) {
  hidden = value
}

export function useSharedTicker(active: () => boolean = () => true) {
  subscribers++
  ensure()
  onCleanup(() => {
    subscribers--
    if (subscribers <= 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
      subscribers = 0
    }
  })
  return () => {
    if (!active()) return tick()
    return tick()
  }
}

export function nowFromTicker(active: () => boolean = () => true) {
  const read = useSharedTicker(active)
  return () => {
    read()
    return Date.now()
  }
}
