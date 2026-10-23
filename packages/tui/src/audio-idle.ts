import type { Audio } from "@opentui/core"

export function createAudioIdleRelease(
  audio: Pick<Audio, "getStats" | "stop">,
  schedule: (check: () => void) => () => void = scheduleIdleCheck,
) {
  let cancel: (() => void) | undefined

  function clear() {
    cancel?.()
    cancel = undefined
  }

  return {
    watch() {
      if (cancel !== undefined) return
      cancel = schedule(() => {
        const stats = audio.getStats()
        if (!stats || stats.voicesActive !== 0) return
        if (audio.stop()) clear()
      })
    },
    dispose: clear,
  }
}

function scheduleIdleCheck(check: () => void) {
  const timer = setInterval(check, 100)
  timer.unref()
  return () => clearInterval(timer)
}
