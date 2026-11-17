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

const a = "opencode-plugin-a@latest"

const b = "opencode-plugin-b@latest"

/** A listed package source, which carries `outdated` only when it is true. */
function listed(target: string, outdated: boolean): Parameters<typeof pluginUpdateView>[1] {
  if (!outdated) return { target }

  return { target, outdated: true }
}

test("a check claims itself at once, ignores a second request, and its result overrides the listed flags", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  const checking = run.machine.state
  run.dispatch({ type: "check.requested" })

  expect(run.machine.state).toBe(checking)
  expect(pluginUpdateChecking(run.machine.state)).toBe(true)
  expect(run.effects).toEqual([{ type: "check", attempt: 0 }])

  run.dispatch({ type: "check.succeeded", attempt: 0, outdated: { [a]: true } })

  expect(pluginUpdateChecking(run.machine.state)).toBe(false)
  expect(pluginUpdateView(run.machine.state, listed(a, false))).toEqual({ outdated: true, updating: false })
})

test("a failed check ends idle and reports the error", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "check.failed", attempt: 0, message: "offline" })

  expect(pluginUpdateChecking(run.machine.state)).toBe(false)
  expect(run.effects.at(-1)).toEqual({ type: "failed", message: "offline" })
})

test("an update runs once per package, then refreshes the list and hides the button", () => {
  const run = harness()

  run.dispatch({ type: "update.requested", target: a })
  const updating = run.machine.state
  run.dispatch({ type: "update.requested", target: a })

  expect(run.machine.state).toBe(updating)
  expect(pluginUpdateView(run.machine.state, listed(a, true))).toEqual({ outdated: true, updating: true })

  run.dispatch({ type: "update.succeeded", id: 0 })

  expect(run.effects).toEqual([{ type: "update", id: 0, target: a }, { type: "refresh" }])
  expect(pluginUpdateView(run.machine.state, listed(a, true))).toEqual({ outdated: false, updating: false })
})

// The server reloads its plugins after the update returns, so the refresh can read the old flag. Before, any list load
// cleared what the update learned and the Update button came back until the next reload.
test("a list read before the server reloaded keeps an update's finding until a list agrees", () => {
  const run = harness()

  run.dispatch({ type: "update.requested", target: a })
  run.dispatch({ type: "update.succeeded", id: 0 })
  const updated = run.machine.state

  run.dispatch({ type: "list.loaded", outdated: { [a]: true } })

  expect(run.machine.state).toBe(updated)
  expect(pluginUpdateView(run.machine.state, listed(a, true)).outdated).toBe(false)

  run.dispatch({ type: "list.loaded", outdated: { [a]: false } })

  expect(run.machine.state).not.toBe(updated)
  expect(pluginUpdateView(run.machine.state, listed(a, true)).outdated).toBe(true)
  expect(pluginUpdateView(run.machine.state, listed(a, false)).outdated).toBe(false)
})

test("a check that began before an update cannot mark the updated package outdated again", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "update.requested", target: a })
  run.dispatch({ type: "update.succeeded", id: 1 })
  run.dispatch({ type: "check.succeeded", attempt: 0, outdated: { [a]: true, [b]: true } })

  expect(pluginUpdateView(run.machine.state, listed(a, false)).outdated).toBe(false)
  expect(pluginUpdateView(run.machine.state, listed(b, false)).outdated).toBe(true)

  // Nor while the update is still running.
  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "update.requested", target: b })
  run.dispatch({ type: "check.succeeded", attempt: 2, outdated: { [b]: false } })

  expect(pluginUpdateView(run.machine.state, listed(b, false))).toEqual({ outdated: true, updating: true })
})

test("a failed update keeps the package outdated and reports the error", () => {
  const run = harness()

  run.dispatch({ type: "update.requested", target: a })
  run.dispatch({ type: "update.failed", id: 0, message: "npm failed" })

  expect(pluginUpdateView(run.machine.state, listed(a, true))).toEqual({ outdated: true, updating: false })
  expect(run.effects.at(-1)).toEqual({ type: "failed", message: "npm failed" })
})

test("results from before a server change or after dispose are ignored", () => {
  const run = harness()

  run.dispatch({ type: "check.requested" })
  run.dispatch({ type: "update.requested", target: a })
  run.dispatch({ type: "server.changed" })
  const changed = run.machine.state

  run.dispatch({ type: "check.succeeded", attempt: 0, outdated: { [a]: true } })
  run.dispatch({ type: "update.failed", id: 1, message: "late" })

  expect(run.machine.state).toBe(changed)
  expect(pluginUpdateView(run.machine.state, listed(a, false))).toEqual({ outdated: false, updating: false })

  run.dispatch({ type: "disposed" })
  const disposed = run.machine.state
  run.dispatch({ type: "check.requested" })

  expect(run.machine.state).toBe(disposed)
  expect(run.effects).toEqual([
    { type: "check", attempt: 0 },
    { type: "update", id: 1, target: a },
  ])
})
