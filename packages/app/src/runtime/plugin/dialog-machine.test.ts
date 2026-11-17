import { expect, test } from "bun:test"
import {
  createPluginDialogState,
  transitionPluginDialog,
  type PluginDialogEffect,
  type PluginDialogEvent,
  type PluginDialogState,
} from "./dialog-machine"

/** Folds events through the machine from a new handle, collecting every effect in order. */
function replay(events: readonly PluginDialogEvent[]) {
  return events.reduce<{ state: PluginDialogState; effects: PluginDialogEffect["type"][] }>(
    (current, event) => {
      const next = transitionPluginDialog(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects.map((effect) => effect.type)] }
    },
    { state: createPluginDialogState(), effects: [] },
  )
}

const open: PluginDialogEvent = { type: "open", aborted: false }

// Before, closing a shown dialog ran `ended` once through the stack's onClose and again directly, and once more when
// the scope that opened it went away.
test("closing a shown dialog ends it once, whatever closes it afterwards", () => {
  const run = replay([open, { type: "mounted" }, { type: "close" }, { type: "dismissed" }, { type: "close" }])

  expect(run.state.status).toBe("closed")
  expect(run.effects).toEqual(["register", "wait", "show", "abort", "close", "release", "ended"])
})

// Before, a dialog closed before it mounted kept its close registered with the plugin, which ran `ended` again at
// teardown.
test.each<{ name: string; events: PluginDialogEvent[]; effects: PluginDialogEffect["type"][] }>([
  {
    name: "waits for the app interface",
    events: [open, { type: "close" }, { type: "mounted" }],
    effects: ["register", "wait", "cancel", "release", "ended"],
  },
  {
    name: "waits for the stack to mount it",
    // The stack sees the aborted open and reports it dropped.
    events: [open, { type: "mounted" }, { type: "close" }, { type: "dismissed" }],
    effects: ["register", "wait", "show", "abort", "close", "release", "ended"],
  },
])("a dialog closed while it $name is released and ends once", (input) => {
  expect(replay(input.events).effects).toEqual(input.effects)
})

test("a dialog the stack dismisses ends without closing anything else", () => {
  const run = replay([open, { type: "mounted" }, { type: "dismissed" }, { type: "close" }])

  expect(run.effects).toEqual(["register", "wait", "show", "release", "ended"])
})

test("a dialog asked of a plugin that went away ends at once and registers nothing", () => {
  const run = replay([{ type: "open", aborted: true }, { type: "mounted" }, { type: "close" }])

  expect(run.effects).toEqual(["ended"])
  expect(transitionPluginDialog(run.state, { type: "close" }).state).toBe(run.state)
})
