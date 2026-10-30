import { createSignal } from "solid-js"

// The local calendar day as a signal. A computation that reads it re-runs when the day changes,
// so a "today" decision (time only, or date and time) flips at 00:00 with nothing else
// re-rendering. One timeout serves every reader. It is armed on the first read and fires just
// after the next local midnight, or after `maxWait` if that comes first, so a suspend or a clock
// or timezone change is caught within the hour; each firing re-arms it.
export function createDayClock(maxWait = 3_600_000) {
  const key = () => {
    const now = new Date()
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  }
  const [day, setDay] = createSignal(0)
  let current = key()
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    timer = setTimeout(
      () => {
        if (key() !== current) {
          current = key()
          setDay((value) => value + 1)
        }
        arm()
      },
      Math.min(maxWait, midnight - now.getTime() + 50),
    )
    timer.unref?.()
  }

  return {
    read() {
      if (!timer) {
        current = key()
        arm()
      }
      return day()
    },
    armed: () => timer !== undefined,
    stop() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}

export const localDay = createDayClock()
