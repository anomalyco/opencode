type Timer = {
  set(fn: () => void, interval: number): unknown
  clear(id: unknown): void
}

type Doc = {
  visibilityState: string
  addEventListener(name: "visibilitychange", fn: () => void): void
  removeEventListener(name: "visibilitychange", fn: () => void): void
}

const browserTimer: Timer = {
  set(fn, interval) {
    return setInterval(fn, interval)
  },
  clear(id) {
    clearInterval(id as ReturnType<typeof setInterval>)
  },
}

export function startVisiblePoll(input: { doc?: Doc; interval: number; run: () => void; timer?: Timer }) {
  const timer = input.timer ?? browserTimer
  let id: unknown

  const stop = () => {
    if (id === undefined) return
    timer.clear(id)
    id = undefined
  }

  const start = () => {
    if (id !== undefined) return
    input.run()
    id = timer.set(input.run, input.interval)
  }

  if (!input.doc) {
    start()
    return stop
  }

  const sync = () => {
    if (input.doc?.visibilityState === "visible") {
      start()
      return
    }
    stop()
  }

  input.doc.addEventListener("visibilitychange", sync)
  sync()

  return () => {
    stop()
    input.doc?.removeEventListener("visibilitychange", sync)
  }
}
