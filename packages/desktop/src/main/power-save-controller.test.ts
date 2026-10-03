import { describe, expect, test } from "bun:test"
import { createKeepAwakeController, type PowerSaveBlockerLike } from "./power-save-controller"

function setup(initial = false) {
  let enabled = initial
  let nextId = 1
  const started = new Set<number>()
  const calls: Array<{ type: "start"; value: string } | { type: "stop"; value: number }> = []
  const blocker: PowerSaveBlockerLike = {
    start(type) {
      const id = nextId++
      started.add(id)
      calls.push({ type: "start", value: type })
      return id
    },
    stop(id) {
      started.delete(id)
      calls.push({ type: "stop", value: id })
    },
    isStarted(id) {
      return started.has(id)
    },
  }
  const controller = createKeepAwakeController(blocker, {
    get: () => enabled,
    set: (value) => {
      enabled = value
    },
  })
  return { controller, calls, started, enabled: () => enabled }
}

describe("keep awake controller", () => {
  test("does not start when the persisted setting is disabled", () => {
    const state = setup(false)
    state.controller.initialize()
    expect(state.calls).toEqual([])
  })

  test("uses prevent-display-sleep when the persisted setting is enabled", () => {
    const state = setup(true)
    state.controller.initialize()
    expect(state.calls).toEqual([{ type: "start", value: "prevent-display-sleep" }])
  })

  test("enabling repeatedly is idempotent", () => {
    const state = setup(false)
    state.controller.setEnabled(true)
    state.controller.setEnabled(true)
    expect(state.calls).toEqual([{ type: "start", value: "prevent-display-sleep" }])
    expect(state.enabled()).toBe(true)
  })

  test("disabling stops the active blocker", () => {
    const state = setup(false)
    state.controller.setEnabled(true)
    state.controller.setEnabled(false)
    expect(state.calls).toEqual([
      { type: "start", value: "prevent-display-sleep" },
      { type: "stop", value: 1 },
    ])
    expect(state.enabled()).toBe(false)
  })

  test("stop releases the blocker without changing the persisted preference", () => {
    const state = setup(true)
    state.controller.initialize()
    state.controller.stop()
    expect(state.calls).toEqual([
      { type: "start", value: "prevent-display-sleep" },
      { type: "stop", value: 1 },
    ])
    expect(state.enabled()).toBe(true)
  })

  test("restarts the blocker if Electron no longer reports it as active", () => {
    const state = setup(false)
    state.controller.setEnabled(true)
    state.started.clear()
    state.controller.setEnabled(true)
    expect(state.calls).toEqual([
      { type: "start", value: "prevent-display-sleep" },
      { type: "start", value: "prevent-display-sleep" },
    ])
  })
})
