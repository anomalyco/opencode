import { describe, expect, test } from "bun:test"
import {
  createDesktopStorageState,
  transitionDesktopStorage,
  type DesktopStorageEffect,
  type DesktopStorageEvent,
  type DesktopStorageState,
  type StorageItems,
} from "./storage-machine"

type Namespace = { readonly name: string }

const reply = () => Promise.withResolvers<StorageItems>()

function replay(events: readonly DesktopStorageEvent<Namespace>[], from = createDesktopStorageState<Namespace>()) {
  return events.reduce<{ state: DesktopStorageState<Namespace>; effects: DesktopStorageEffect<Namespace>[] }>(
    (run, event) => {
      const next = transitionDesktopStorage(run.state, event)

      return { state: next.state, effects: [...run.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

// What each read was answered with: the seed it was served, or a trip to main.
function answers(effects: readonly DesktopStorageEffect<Namespace>[]) {
  return effects.flatMap((effect): (StorageItems | string)[] => {
    if (effect.type === "resolve-items") return [effect.value]

    if (effect.type === "fetch-items") return [`fetch ${effect.name}`]

    if (effect.type === "reject-items") return ["rejected"]

    return []
  })
}

const windowFile = "opencode.window.1.dat"

describe("preload snapshot seed", () => {
  test("a change made before the window opened its namespace reaches the first read", () => {
    const run = replay([
      { type: "snapshot.settled", snapshot: { [windowFile]: { items: { tabs: "old", stale: "x" }, revision: 3 } } },
      { type: "store.changed", name: windowFile, insert: { tabs: "new" }, remove: ["stale"], revision: 4 },
      { type: "items.requested", name: windowFile, reply: reply() },
      { type: "items.requested", name: windowFile, reply: reply() },
    ])

    // On dev the change was dropped and the read got `{ tabs: "old", stale: "x" }` at revision 3.
    expect(answers(run.effects)).toEqual([{ items: { tabs: "new" }, revision: 4 }, `fetch ${windowFile}`])
  })

  test("changes that arrive before the snapshot fold in only when newer than it", () => {
    const run = replay([
      { type: "items.requested", name: "opencode.global.dat", reply: reply() },
      { type: "store.changed", name: "default.dat", insert: { theme: "older" }, remove: [], revision: 2 },
      { type: "store.changed", name: "default.dat", insert: { theme: "dark" }, remove: [], revision: 3 },
      {
        type: "snapshot.settled",
        snapshot: {
          "opencode.global.dat": { items: { a: "1" }, revision: 2 },
          "default.dat": { items: { theme: "light", font: "mono" }, revision: 2 },
        },
      },
      { type: "items.requested", name: "default.dat", reply: reply() },
    ])

    expect(answers(run.effects)).toEqual([
      { items: { a: "1" }, revision: 2 },
      { items: { theme: "dark", font: "mono" }, revision: 3 },
    ])
  })

  test("a change older than the seed leaves it alone", () => {
    const run = replay([
      { type: "snapshot.settled", snapshot: { "default.dat": { items: { theme: "dark" }, revision: 5 } } },
      { type: "store.changed", name: "default.dat", insert: { theme: "light" }, remove: [], revision: 4 },
      { type: "items.requested", name: "default.dat", reply: reply() },
    ])

    expect(answers(run.effects)).toEqual([{ items: { theme: "dark" }, revision: 5 }])
  })

  test("a namespace the snapshot lacks is read from main, never from its changes alone", () => {
    const run = replay([
      { type: "store.changed", name: "other.dat", insert: { a: "1" }, remove: [], revision: 1 },
      { type: "snapshot.settled", snapshot: {} },
      { type: "store.changed", name: "other.dat", insert: { b: "2" }, remove: [], revision: 2 },
      { type: "items.requested", name: "other.dat", reply: reply() },
    ])

    expect(answers(run.effects)).toEqual(["fetch other.dat"])
  })

  test("an opened namespace hears every change, before and after the snapshot", () => {
    const namespace = { name: "default.dat" }

    const run = replay([
      { type: "namespace.opened", name: "default.dat", namespace },
      { type: "store.changed", name: "default.dat", insert: { a: "1" }, remove: [], revision: 1 },
      { type: "snapshot.settled", snapshot: {} },
      { type: "store.changed", name: "default.dat", insert: {}, remove: ["a"], revision: 2 },
      { type: "store.changed", name: "other.dat", insert: { b: "2" }, remove: [], revision: 3 },
    ])

    expect(run.effects).toEqual([
      { type: "accept-remote", namespace, insert: { a: "1" }, remove: [], revision: 1 },
      { type: "accept-remote", namespace, insert: {}, remove: ["a"], revision: 2 },
    ])
  })
})

describe("disposal", () => {
  test("rejects the reads still waiting for the snapshot and every later one", () => {
    const namespace = { name: "default.dat" }

    const run = replay([
      { type: "namespace.opened", name: "default.dat", namespace },
      { type: "items.requested", name: "default.dat", reply: reply() },
      { type: "disposed" },
      { type: "snapshot.settled", snapshot: { "default.dat": { items: {}, revision: 1 } } },
      { type: "store.changed", name: "default.dat", insert: { a: "1" }, remove: [], revision: 2 },
      { type: "items.requested", name: "default.dat", reply: reply() },
    ])

    expect(answers(run.effects)).toEqual(["rejected", "rejected"])
    expect(run.effects.some((effect) => effect.type === "accept-remote")).toBe(false)
    // Queued writes still flush on pagehide through the namespaces opened before.
    expect(run.state.opened.get("default.dat")).toBe(namespace)
  })
})
