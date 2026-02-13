export const listenTerminalFit = (fit: () => void) => {
  if (typeof window === "undefined") return () => {}

  const handle = () => fit()
  window.addEventListener("opencode:terminal-fit", handle)
  return () => window.removeEventListener("opencode:terminal-fit", handle)
}

export const scheduleTerminalFit = (fit: () => void) => {
  fit()

  const raf = globalThis.requestAnimationFrame
  if (typeof raf === "function") {
    raf(() => fit())
    return
  }

  setTimeout(() => fit(), 0)
}

export const fitUntilVisible = (input: {
  measure: () => { width: number; height: number }
  fit: () => void
  max?: number
  min?: number
  log?: (...args: unknown[]) => void
}) => {
  const max = input.max ?? 12
  const min = input.min ?? 8

  const state = { alive: true, n: 0, id: 0 as number, kind: "raf" as "raf" | "timeout" }

  const cancel = () => {
    state.alive = false
    if (!state.id) return
    if (state.kind === "raf") cancelAnimationFrame(state.id)
    else clearTimeout(state.id)
  }

  const tick = () => {
    if (!state.alive) return
    state.n += 1

    const box = input.measure()
    input.log?.("fit", { n: state.n, w: box.width, h: box.height })
    input.fit()

    if (box.width >= min && box.height >= min) return
    if (state.n >= max) return

    const raf = globalThis.requestAnimationFrame
    if (typeof raf === "function") {
      state.kind = "raf"
      state.id = raf(tick)
      return
    }

    state.kind = "timeout"
    state.id = setTimeout(tick, 0) as unknown as number
  }

  tick()
  return cancel
}
