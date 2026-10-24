import { createSignal, getOwner, onCleanup } from "solid-js"

// One clock shared by everything that ticks at the same interval. It runs only while something
// holds it: the interval stops itself on the first tick after the last holder lets go, so a
// holder released and re-taken in the same update (a memo re-running) does not restart it.
export function createTicker(interval: number) {
  const [now, setNow] = createSignal(Date.now())
  let holders = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const hold = () => {
    holders++
    if (!timer) {
      setNow(Date.now())
      timer = setInterval(() => {
        if (holders > 0) return setNow(Date.now())
        clearInterval(timer)
        timer = undefined
      }, interval)
    }
    let held = true
    return () => {
      if (!held) return
      held = false
      holders--
    }
  }

  return {
    now,
    hold,
    running: () => timer !== undefined,
    // The current time, held until the calling computation re-runs or is disposed.
    watch() {
      if (getOwner()) onCleanup(hold())
      return now()
    },
  }
}

export const secondTicker = createTicker(1000)
