import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Store } from "@opencode/plugin/gui"
import type { Entry } from "@opencode/plugin/gui/host"
import {
  createPluginHostState,
  selectPluginDefinitions,
  selectPluginFailure,
  selectPluginInstance,
  selectPluginInstances,
  selectPluginSettled,
  selectPluginStatus,
  transitionPluginHost,
  type PluginHostEffect,
  type PluginHostEvent,
  type PluginHostState,
} from "./instance-machine"

type Instance = { readonly name: string }

const setup = () => {}

const windowEntry = async () => ({ default: setup })

const acme: Entry = { id: "acme", windowEntry }

/** Acme with a declared global store, which loads before setup. */
const stored: Entry = {
  ...acme,
  stores: { prefs: Store.global(Schema.Struct({ open: Schema.Boolean }), { open: false }) },
}

const enabled = new Set<string>()

/** Folds events through the machine, collecting every effect in order. */
function replay(events: readonly PluginHostEvent<Instance>[], from = createPluginHostState<Instance>()) {
  return events.reduce<{ state: PluginHostState<Instance>; effects: PluginHostEffect<Instance>[] }>(
    (current, event) => {
      const next = transitionPluginHost(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

function types(effects: readonly PluginHostEffect<Instance>[]) {
  return effects.map((effect) => effect.type)
}

/** Runs acme to active through its store read, as the driver does. */
function activeAcme(definition: Entry = stored) {
  const instance = { name: "first" }

  return {
    instance,
    ...replay([
      { type: "reconcile", definitions: [definition], disabled: enabled },
      { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
      { type: "created", id: "acme", attempt: 1, instance, setup },
      ...(definition.stores ? [{ type: "prepared", id: "acme", attempt: 1 } as const] : []),
      { type: "started", id: "acme", attempt: 1 },
    ]),
  }
}

test("a plugin loads, creates its instance, reads its stores, sets up and becomes active", () => {
  const run = activeAcme()

  expect(types(run.effects)).toEqual(["load", "timer.start", "create", "prepare", "start", "timer.stop"])
  expect(selectPluginStatus(run.state, "acme")).toBe("active")
  expect(selectPluginInstance(run.state, "acme")).toBe(run.instance)
  expect(selectPluginInstances(run.state)).toEqual([run.instance])
  expect(selectPluginSettled(run.state, "acme")).toBe(true)
})

test("a plugin without stores starts as soon as its instance exists", () => {
  const instance = { name: "first" }

  const run = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
    { type: "created", id: "acme", attempt: 1, instance, setup },
  ])

  expect(run.effects.at(-1)).toEqual({ type: "start", id: "acme", attempt: 1, instance, setup })
  // Contributions made during setup render with the instance's context before setup returns.
  expect(selectPluginStatus(run.state, "acme")).toBe("loading")
  expect(selectPluginInstance(run.state, "acme")).toBe(instance)
})

// Before, a window entry or store read that never settled left the plugin "Loading" forever.
test("an activation that never settles times out into failed and disposes what it created", () => {
  const loading = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "timeout", id: "acme", attempt: 1 },
  ])

  expect(types(loading.effects)).toEqual(["load", "timer.start", "timer.stop", "log"])
  expect(selectPluginStatus(loading.state, "acme")).toBe("failed")
  expect(selectPluginFailure(loading.state, "acme")?.error).toContain("Plugin activation timed out")

  const instance = { name: "first" }

  const preparing = replay([
    { type: "reconcile", definitions: [stored], disabled: enabled },
    { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
    { type: "created", id: "acme", attempt: 1, instance, setup },
    { type: "timeout", id: "acme", attempt: 1 },
  ])

  expect(preparing.effects.slice(-3)).toEqual([
    { type: "timer.stop", id: "acme" },
    { type: "dispose", instance },
    { type: "log", id: "acme", cause: expect.any(Error) },
  ])
  expect(selectPluginStatus(preparing.state, "acme")).toBe("failed")
})

test("a failed load, store read or setup fails the plugin with its error", () => {
  const load = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "failed", id: "acme", attempt: 1, cause: "boom" },
  ])

  expect(selectPluginFailure(load.state, "acme")).toEqual({ phase: "setup", error: "boom" })
  expect(types(load.effects).slice(-2)).toEqual(["timer.stop", "log"])

  const instance = { name: "first" }

  const setupFailed = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
    { type: "created", id: "acme", attempt: 1, instance, setup },
    { type: "failed", id: "acme", attempt: 1, cause: "setup threw" },
    // The driver reports a start behind a failure setup raised; it starts nothing.
    { type: "started", id: "acme", attempt: 1 },
  ])

  expect(selectPluginFailure(setupFailed.state, "acme")).toEqual({ phase: "setup", error: "setup threw" })
  expect(setupFailed.effects).toContainEqual({ type: "dispose", instance })
  expect(selectPluginInstance(setupFailed.state, "acme")).toBeUndefined()
})

test("an effect that throws after setup fails the running plugin and disposes it", () => {
  const run = activeAcme()
  const crashed = transitionPluginHost(run.state, { type: "failed", id: "acme", attempt: 1, cause: "late" })

  expect(crashed.effects).toEqual([
    { type: "dispose", instance: run.instance },
    { type: "log", id: "acme", cause: "late" },
  ])
  expect(selectPluginStatus(crashed.state, "acme")).toBe("failed")
})

// Before, an enabled plugin without a window entry never got a status, so Extensions showed it "Loading" forever
// and hid a failure of its main entry behind that.
test("an enabled plugin without a window entry is active at once", () => {
  const run = replay([{ type: "reconcile", definitions: [{ id: "main-only" }], disabled: enabled }])

  expect(run.effects).toEqual([])
  expect(selectPluginStatus(run.state, "main-only")).toBe("active")
  expect(selectPluginInstance(run.state, "main-only")).toBeUndefined()
  expect(selectPluginInstances(run.state)).toEqual([])
})

// Before, a reload while startup waited for the settings changed nothing the watcher would see; a failed plugin
// stayed failed once the settings arrived, and a windowless replacement left the old status.
test("a reload while startup waits for the settings starts the replacement once they arrive", () => {
  const next: Entry = { id: "acme", windowEntry: async () => ({ default: () => {} }) }

  const waiting = replay([
    { type: "reconcile", definitions: [acme], disabled: undefined },
    { type: "reload", id: "acme", next },
  ])

  expect(waiting.effects).toEqual([])
  expect(selectPluginStatus(waiting.state, "acme")).toBeUndefined()
  expect(selectPluginDefinitions(waiting.state, [acme])).toEqual([next])
  expect(selectPluginSettled(waiting.state, "acme")).toBe(false)

  const started = transitionPluginHost(waiting.state, { type: "reconcile", definitions: [acme], disabled: enabled })

  expect(started.effects[0]).toMatchObject({ type: "load", attempt: 1, definition: next, load: next.windowEntry })
})

test("a failed plugin reloaded with a windowless replacement is active", () => {
  const failed = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "failed", id: "acme", attempt: 1, cause: "boom" },
    { type: "reload", id: "acme", next: { id: "acme" } },
  ])

  expect(selectPluginStatus(failed.state, "acme")).toBe("active")
  expect(selectPluginFailure(failed.state, "acme")).toBeUndefined()
})

// Before, a contribution failing in the same turn its plugin was disabled, reloaded or removed recorded its error
// against that plugin, and overwrote a setup failure.
test.each<{ name: string; events: PluginHostEvent<Instance>[] }>([
  { name: "disabled", events: [{ type: "reconcile", definitions: [acme], disabled: new Set(["acme"]) }] },
  { name: "loading", events: [{ type: "reconcile", definitions: [acme], disabled: enabled }] },
  {
    name: "failed",
    events: [
      { type: "reconcile", definitions: [acme], disabled: enabled },
      { type: "failed", id: "acme", attempt: 1, cause: "setup" },
    ],
  },
  { name: "unlisted", events: [{ type: "reconcile", definitions: [], disabled: enabled }] },
])("a late render failure records nothing on a $name plugin", (input) => {
  const before = replay(input.events).state
  const failure = selectPluginFailure(before, "acme")
  const next = transitionPluginHost(before, { type: "render.failed", id: "acme", cause: "render" })

  expect(next.state).toBe(before)
  expect(next.effects).toEqual([{ type: "log", id: "acme", cause: "render" }])
  expect(selectPluginFailure(next.state, "acme")).toEqual(failure)
})

test("a render failure of an active plugin is recorded and the plugin stays active", () => {
  const run = activeAcme()
  const next = transitionPluginHost(run.state, { type: "render.failed", id: "acme", cause: "render" })

  expect(selectPluginStatus(next.state, "acme")).toBe("active")
  expect(selectPluginFailure(next.state, "acme")).toEqual({ phase: "render", error: "render" })
  expect(transitionPluginHost(next.state, { type: "render.failed", id: "acme", cause: "render" }).state).toBe(
    next.state,
  )

  const reloaded = transitionPluginHost(next.state, { type: "reload", id: "acme", next: undefined })

  expect(selectPluginFailure(reloaded.state, "acme")).toBeUndefined()
})

test("results of superseded attempts change nothing, and a superseded instance is disposed", () => {
  const run = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "reload", id: "acme", next: undefined },
    { type: "reload", id: "acme", next: undefined },
  ])

  expect(run.effects.filter((effect) => effect.type === "load").map((effect) => effect.attempt)).toEqual([1, 2, 3])

  const stale: PluginHostEvent<Instance>[] = [
    { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
    { type: "failed", id: "acme", attempt: 2, cause: "second" },
    { type: "prepared", id: "acme", attempt: 1 },
    { type: "started", id: "acme", attempt: 1 },
    { type: "timeout", id: "acme", attempt: 1 },
  ]

  stale.forEach((event) => expect(transitionPluginHost(run.state, event)).toEqual({ state: run.state, effects: [] }))

  const instance = { name: "stale" }
  const created = transitionPluginHost(run.state, { type: "created", id: "acme", attempt: 1, instance, setup })

  expect(created.state).toBe(run.state)
  expect(created.effects).toEqual([{ type: "dispose", instance }])
})

test("disabling stops a running plugin and clears a failure; enabling starts it again", () => {
  const run = activeAcme(acme)
  const off = new Set(["acme"])
  const disabled = transitionPluginHost(run.state, { type: "reconcile", definitions: [acme], disabled: off })

  expect(disabled.effects).toEqual([{ type: "dispose", instance: run.instance }])
  expect(selectPluginStatus(disabled.state, "acme")).toBe("disabled")
  expect(transitionPluginHost(disabled.state, { type: "reconcile", definitions: [acme], disabled: off }).state).toBe(
    disabled.state,
  )
  // A reload of a disabled plugin keeps it off.
  expect(transitionPluginHost(disabled.state, { type: "reload", id: "acme", next: undefined }).state).toBe(
    disabled.state,
  )

  const failed = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "failed", id: "acme", attempt: 1, cause: "boom" },
    { type: "reconcile", definitions: [acme], disabled: off },
  ])

  expect(selectPluginFailure(failed.state, "acme")).toBeUndefined()

  const again = transitionPluginHost(failed.state, { type: "reconcile", definitions: [acme], disabled: enabled })

  expect(types(again.effects)).toEqual(["load", "timer.start"])
})

test("a failed plugin waits for Reload or a new revision; other changes do not retry it", () => {
  const failed = replay([
    { type: "reconcile", definitions: [acme], disabled: enabled },
    { type: "failed", id: "acme", attempt: 1, cause: "boom" },
  ])

  const unrelated = transitionPluginHost(failed.state, {
    type: "reconcile",
    definitions: [acme, { id: "other" }],
    disabled: new Set(["other"]),
  })

  expect(unrelated.effects).toEqual([])
  expect(selectPluginStatus(unrelated.state, "acme")).toBe("failed")

  const revision: Entry = { id: "acme", windowEntry }

  const restarted = transitionPluginHost(failed.state, {
    type: "reconcile",
    definitions: [revision],
    disabled: enabled,
  })

  expect(types(restarted.effects)).toEqual(["forget", "load", "timer.start"])
  expect(selectPluginStatus(restarted.state, "acme")).toBe("loading")
})

test("a new revision drops the previous reload's replacement and a plugin that leaves is forgotten", () => {
  const run = activeAcme(acme)
  const reloaded = transitionPluginHost(run.state, { type: "reload", id: "acme", next: { id: "acme", windowEntry } })
  const revision: Entry = { id: "acme" }

  const replaced = transitionPluginHost(reloaded.state, {
    type: "reconcile",
    definitions: [revision],
    disabled: enabled,
  })

  expect(selectPluginDefinitions(replaced.state, [revision])).toEqual([revision])

  const left = transitionPluginHost(run.state, { type: "reconcile", definitions: [], disabled: enabled })

  expect(left.effects).toEqual([
    { type: "dispose", instance: run.instance },
    { type: "forget", id: "acme" },
  ])
  expect(selectPluginStatus(left.state, "acme")).toBeUndefined()
  // Startup stops waiting for a plugin that left before it settled.
  expect(selectPluginSettled(left.state, "acme")).toBe(true)
})

test("the same definitions and settings change nothing", () => {
  const run = activeAcme(acme)

  expect(transitionPluginHost(run.state, { type: "reconcile", definitions: [acme], disabled: new Set() }).state).toBe(
    run.state,
  )
})

test("disposing tears down every running plugin, then ignores everything but an instance created late", () => {
  const instance = { name: "first" }
  const preparing = { name: "preparing" }

  const run = replay([
    {
      type: "reconcile",
      definitions: [acme, { id: "slow", windowEntry }, { id: "boot", windowEntry }],
      disabled: enabled,
    },
    { type: "loaded", id: "acme", attempt: 1, setup, messages: {} },
    { type: "created", id: "acme", attempt: 1, instance, setup },
    { type: "started", id: "acme", attempt: 1 },
    { type: "loaded", id: "boot", attempt: 3, setup, messages: {} },
    { type: "created", id: "boot", attempt: 3, instance: preparing, setup },
  ])

  const disposed = transitionPluginHost(run.state, { type: "disposed" })

  expect(disposed.effects).toEqual([
    { type: "dispose", instance },
    { type: "timer.stop", id: "slow" },
    { type: "timer.stop", id: "boot" },
    { type: "dispose", instance: preparing },
  ])
  expect(selectPluginInstances(disposed.state)).toEqual([])

  const late = { name: "late" }

  expect(transitionPluginHost(disposed.state, { type: "loaded", id: "slow", attempt: 2, setup, messages: {} })).toEqual(
    {
      state: disposed.state,
      effects: [],
    },
  )
  expect(
    transitionPluginHost(disposed.state, { type: "created", id: "slow", attempt: 2, instance: late, setup }),
  ).toEqual({ state: disposed.state, effects: [{ type: "dispose", instance: late }] })
})
