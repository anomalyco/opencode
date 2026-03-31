import { describe, expect, test } from "bun:test"
import { startVisiblePoll } from "./server-poll"

function doc(state: "visible" | "hidden") {
  let current = state
  const listeners = new Map<string, Set<() => void>>()
  return {
    get visibilityState() {
      return current
    },
    addEventListener(name: string, fn: () => void) {
      const set = listeners.get(name) ?? new Set<() => void>()
      set.add(fn)
      listeners.set(name, set)
    },
    removeEventListener(name: string, fn: () => void) {
      listeners.get(name)?.delete(fn)
    },
    dispatch(next: "visible" | "hidden") {
      current = next
      for (const fn of listeners.get("visibilitychange") ?? []) fn()
    },
  }
}

describe("startVisiblePoll", () => {
  test("runs only while visible and resumes on visibility changes", () => {
    const events: string[] = []
    const timers = new Map<number, () => void>()
    let next = 1
    const page = doc("hidden")

    const stop = startVisiblePoll({
      doc: page,
      interval: 10_000,
      run() {
        events.push("run")
      },
      timer: {
        set(fn) {
          const id = next++
          timers.set(id, fn)
          events.push(`set:${id}`)
          return id
        },
        clear(id) {
          timers.delete(id as number)
          events.push(`clear:${id}`)
        },
      },
    })

    expect(events).toEqual([])

    page.dispatch("visible")
    expect(events).toEqual(["run", "set:1"])

    timers.get(1)?.()
    expect(events).toEqual(["run", "set:1", "run"])

    page.dispatch("hidden")
    expect(events).toEqual(["run", "set:1", "run", "clear:1"])

    page.dispatch("visible")
    expect(events).toEqual(["run", "set:1", "run", "clear:1", "run", "set:2"])

    stop()
    expect(events).toEqual(["run", "set:1", "run", "clear:1", "run", "set:2", "clear:2"])
  })
})
