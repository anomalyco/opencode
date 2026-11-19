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

const [today, setToday] = createSignal(0)

let subscribers = 0

let timer: ReturnType<typeof setInterval> | undefined

// One shared clock for every relative timestamp on screen; it only ticks while one is mounted. Timers stop while the
// machine sleeps, so it also catches up as soon as the page is shown or focused again.
export function useNow() {
  subscribers++

  if (subscribers === 1) {
    tick()
    timer = setInterval(tick, 30_000)
    document.addEventListener("visibilitychange", tick)
    window.addEventListener("focus", tick)
  }

  onCleanup(() => {
    subscribers--

    if (subscribers > 0) return

    clearInterval(timer)
    document.removeEventListener("visibilitychange", tick)
    window.removeEventListener("focus", tick)
  })

  return now
}

// The start of the local day on the shared clock. It changes only when the date does (or the clock or time zone), so
// labels that name the day redraw once a day, and a tick costs the same however many labels are on screen.
export function useToday() {
  useNow()

  return today
}

function tick() {
  const value = Date.now()
  const date = new Date(value)

  setNow(value)
  setToday(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime())
}
