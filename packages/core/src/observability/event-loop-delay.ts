const ResolutionMs = 20

export function makeEventLoopDelayMonitor() {
  const state = {
    expectedAt: performance.now() + ResolutionMs,
    maxMs: 0,
    stoppedAt: undefined as number | undefined,
  }
  const timer = setInterval(() => {
    const now = performance.now()
    state.maxMs = Math.max(state.maxMs, now - state.expectedAt)
    state.expectedAt = now + ResolutionMs
  }, ResolutionMs)
  timer.unref()

  const maxMs = () => Math.max(0, state.maxMs, (state.stoppedAt ?? performance.now()) - state.expectedAt)
  return {
    maxMs,
    stop: () => {
      if (state.stoppedAt === undefined) {
        state.stoppedAt = performance.now()
        clearInterval(timer)
      }
      return maxMs()
    },
  }
}
