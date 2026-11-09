import { createSignal, onCleanup } from "solid-js"

const MINUTE = 60_000

const HOUR = 60 * MINUTE

const DAY = 24 * HOUR

export function relativeTime(created: number, now: number) {
  const elapsed = Math.max(0, now - created)

  if (elapsed < MINUTE) return { unit: "now" } as const

  if (elapsed < HOUR) return { unit: "minute", count: Math.floor(elapsed / MINUTE) } as const

  if (elapsed < DAY) return { unit: "hour", count: Math.floor(elapsed / HOUR) } as const

  if (elapsed < 7 * DAY) return { unit: "day", count: Math.floor(elapsed / DAY) } as const

  return { unit: "date" } as const
}

const [now, setNow] = createSignal(Date.now())

let subscribers = 0

let timer: ReturnType<typeof setInterval> | undefined

// One shared clock for every relative timestamp on screen; it only ticks while one is mounted.
export function useNow() {
  subscribers++

  if (subscribers === 1) {
    setNow(Date.now())
    timer = setInterval(() => setNow(Date.now()), 30_000)
  }

  onCleanup(() => {
    subscribers--

    if (subscribers === 0) clearInterval(timer)
  })

  return now
}
