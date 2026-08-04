export type StashGesture = "esc" | "left"

type ScheduleStashArm = (callback: () => void, timeout: number) => () => void

function scheduleStashArm(callback: () => void, timeout: number) {
  const timer = setTimeout(callback, timeout)
  return () => clearTimeout(timer)
}

export function createStashArm(input: {
  current(): StashGesture | null
  set(value: StashGesture | null): void
  timeout?: number
  schedule?: ScheduleStashArm
}) {
  let cancel: (() => void) | undefined
  let generation = 0

  function cancelTimer() {
    generation += 1
    cancel?.()
    cancel = undefined
  }

  return {
    current: () => input.current(),
    press(gesture: StashGesture) {
      const confirmed = input.current() === gesture
      cancelTimer()
      input.set(confirmed ? null : gesture)
      if (confirmed) return true

      const armedGeneration = generation
      cancel = (input.schedule ?? scheduleStashArm)(() => {
        if (generation !== armedGeneration) return
        cancel = undefined
        if (input.current() === gesture) input.set(null)
      }, input.timeout ?? 3000)
      return false
    },
    clear() {
      cancelTimer()
      input.set(null)
    },
    dispose() {
      cancelTimer()
    },
  }
}
