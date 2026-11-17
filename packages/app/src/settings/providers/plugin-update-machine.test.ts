import { expect, test } from "bun:test"
import {
  createPluginUpdateState,
  pluginUpdateChecking,
  pluginUpdateView,
  transitionPluginUpdate,
  type PluginUpdateEffect,
  type PluginUpdateEvent,
} from "./plugin-update-machine"

/** Drives the machine as the Extensions page does, recording every effect it asks for. */
function harness() {
  const machine = { state: createPluginUpdateState() }
  const effects: PluginUpdateEffect[] = []

  const dispatch = (event: PluginUpdateEvent) => {
    const next = transitionPluginUpdate(machine.state, event)

    machine.state = next.state
    effects.push(...next.effects)

    return next
  }

  return { machine, effects, dispatch }
}

const source = { target: "opencode-plugin-a@latest" } as const

test("a check claims itself at once, ignores a second request, and its result overrides the listed flags", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  const checking = run.machine.state
  run.dispatch({ type: "check.requested" })

  expect(run.machine.state).toBe(checking)
  expect(pluginUpdateChecking(run.machine.state)).toBe(true)
  expect(run.effects).toEqual([{ type: "check", attempt: 0 }])

  run.dispatch({ type: "check.succeeded", attempt: 0, outdated: { [source.target]: true } })

  expect(pluginUpdateChecking(run.machine.state)).toBe(false)
  expect(pluginUpdateView(run.machine.state, source)).toEqual({ outdated: true, updating: false })

  run.dispatch({ type: "list.loaded" })

  expect(pluginUpdateView(run.machine.state, source)).toEqual({ outdated: false, updating: false })
  expect(pluginUpdateView(run.machine.state, { ...source, outdated: true })).toEqual({
    outdated: true,
    updating: false,
  })
})

test("a failed check ends idle and reports the error", () => {
  const run = harness()
  const message = "offline"

  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "check.failed", attempt: 0, message })

  expect(pluginUpdateChecking(run.machine.state)).toBe(false)
  expect(run.effects.at(-1)).toEqual({ type: "failed", message })
})

test("an update runs once per package, then refreshes the list and hides the button", () => {
  const run = harness()
  const outdated = { ...source, outdated: true } as const

  run.dispatch({ type: "update.requested", target: source.target })
  const updating = run.machine.state
  run.dispatch({ type: "update.requested", target: source.target })

  expect(run.machine.state).toBe(updating)
  expect(pluginUpdateView(run.machine.state, outdated)).toEqual({ outdated: true, updating: true })

  run.dispatch({ type: "update.succeeded", id: 0 })

  expect(run.effects).toEqual([{ type: "update", id: 0, target: source.target }, { type: "refresh" }])
  // The list still carries the old flag until it loads again.
  expect(pluginUpdateView(run.machine.state, outdated)).toEqual({ outdated: false, updating: false })
})

test("a failed update keeps the package outdated and reports the error", () => {
  const run = harness()
  const message = "npm failed"

  run.dispatch({ type: "update.requested", target: source.target })
  run.dispatch({ type: "update.failed", id: 0, message })

  expect(pluginUpdateView(run.machine.state, { ...source, outdated: true })).toEqual({
    outdated: true,
    updating: false,
  })
  expect(run.effects.at(-1)).toEqual({ type: "failed", message })
})

test("results from before a server change or after dispose are ignored", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "update.requested", target: source.target })
  run.dispatch({ type: "server.changed" })
  const changed = run.machine.state

  run.dispatch({ type: "check.succeeded", attempt: 0, outdated: { [source.target]: true } })
  run.dispatch({ type: "update.failed", id: 1, message: "late" })

  expect(run.machine.state).toBe(changed)
  expect(pluginUpdateView(run.machine.state, source)).toEqual({ outdated: false, updating: false })

  run.dispatch({ type: "disposed" })
  const disposed = run.machine.state
  run.dispatch({ type: "check.requested" })

  expect(run.machine.state).toBe(disposed)
  expect(run.effects).toEqual([
    { type: "check", attempt: 0 },
    { type: "update", id: 1, target: source.target },
  ])
})
