import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"

/** The timestamps a tool call reports: when it was created, when it started running, when it settled. */
export type ElapsedTime = { created: number; ran?: number; completed?: number }

const [now, setNow] = createSignal(Date.now())

let subscribers = 0

let timer: ReturnType<typeof setInterval> | undefined

// One 1s clock for every live duration on screen, so a long session with many running rows keeps a single interval.
function subscribe() {
  if (subscribers++ === 0) {
    setNow(Date.now())
    timer = setInterval(() => setNow(Date.now()), 1_000)
  }

  return () => {
    subscribers--

    if (subscribers > 0) return

    clearInterval(timer)
    timer = undefined
  }
}

/**
 * Milliseconds between `start` and `end`, falling back to the shared clock while `running` has no `end` yet.
 * Returns `undefined` until both ends are known, so a row that has not started or has already settled without
 * a recorded end shows nothing instead of counting from mount.
 */
export function createElapsed(
  start: Accessor<number | undefined>,
  end: Accessor<number | undefined>,
  running: Accessor<boolean>,
) {
  createEffect(() => {
    if (!running() || start() === undefined || end() !== undefined) return

    onCleanup(subscribe())
  })

  return createMemo(() => {
    const from = start()

    const to = end() ?? (running() ? now() : undefined)

    if (from === undefined || to === undefined) return undefined

    return Math.max(0, to - from)
  })
}

/** Counts a tool call from when it started until it settles; `running` keeps the shared clock ticking. */
export function createToolElapsed(time: Accessor<ElapsedTime | undefined>, running: Accessor<boolean>) {
  return createElapsed(
    () => time()?.ran ?? time()?.created,
    () => time()?.completed,
    running,
  )
}
