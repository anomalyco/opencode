import { createComputed, onCleanup } from "solid-js"

export function createSessionOwnership(sessionKey: () => string) {
  let current = sessionKey()
  let generation = 0
  const transition = () => {
    const next = sessionKey()
    if (next === current) return
    current = next
    generation++
  }
  createComputed(transition)
  onCleanup(() => generation++)

  return {
    key: () => {
      transition()
      return `${generation}:${current}`
    },
    capture() {
      transition()
      const captured = generation
      return {
        key: `${captured}:${current}`,
        current: () => {
          transition()
          return generation === captured
        },
        run<T>(action: () => T) {
          transition()
          if (generation !== captured) return
          return action()
        },
      }
    },
  }
}
