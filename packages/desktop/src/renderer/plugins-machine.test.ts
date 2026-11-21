import { describe, expect, test } from "bun:test"
import type { BridgeMenubarItem } from "@opencode/plugin/gui/host"
import {
  createPluginBridgeState,
  selectPluginSubscriptions,
  transitionPluginBridge,
  type PluginBridgeEffect,
  type PluginBridgeEvent,
  type PluginBridgeSubscription,
} from "./plugins-machine"

const subscribe = (): PluginBridgeSubscription => ({ listener: () => undefined })

const item = (id: string): BridgeMenubarItem => ({ menu: "file", id, label: id, enabled: true })

function replay(events: readonly PluginBridgeEvent[]) {
  return events.reduce<{ state: ReturnType<typeof createPluginBridgeState>; effects: PluginBridgeEffect[] }>(
    (run, event) => {
      const next = transitionPluginBridge(run.state, event)

      return { state: next.state, effects: [...run.effects, ...next.effects] }
    },
    { state: createPluginBridgeState(), effects: [] },
  )
}

// Who received which menubar items, in order.
function delivered(effects: readonly PluginBridgeEffect[], subscriptions: readonly PluginBridgeSubscription[]) {
  return effects.flatMap((effect) =>
    effect.type === "notify"
      ? [...effect.subscriptions].map((subscription) => [
          subscriptions.indexOf(subscription),
          effect.items.map((value) => value.id),
        ])
      : [],
  )
}

describe("menubar seed", () => {
  test("a reply to an earlier attachment cannot overwrite the items a reattached window was given", () => {
    const first = subscribe()
    const second = subscribe()

    const run = replay([
      { type: "listener.added", subscription: first },
      { type: "listener.removed", subscription: first },
      { type: "listener.added", subscription: second },
      { type: "menubar.seeded", attempt: 2, items: [item("b")] },
      { type: "menubar.seeded", attempt: 1, items: [item("a")] },
    ])

    expect(delivered(run.effects, [first, second])).toEqual([[1, ["b"]]])
  })

  test("a subscriber that registers after the seed gets the current items", () => {
    const first = subscribe()
    const late = subscribe()

    const run = replay([
      { type: "listener.added", subscription: first },
      { type: "menubar.seeded", attempt: 1, items: [item("a")] },
      { type: "listener.added", subscription: late },
    ])

    expect(delivered(run.effects, [first, late])).toEqual([
      [0, ["a"]],
      [1, ["a"]],
    ])
    expect(run.effects.filter((effect) => effect.type === "seed-menubar")).toHaveLength(1)
  })

  test("main's push wins over the seed still on its way", () => {
    const first = subscribe()

    const run = replay([
      { type: "listener.added", subscription: first },
      { type: "menubar.changed", items: [item("b")] },
      { type: "menubar.seeded", attempt: 1, items: [item("a")] },
    ])

    expect(delivered(run.effects, [first])).toEqual([[0, ["b"]]])
  })

  test("a failed seed is asked again when the next subscriber registers, without attaching twice", () => {
    const first = subscribe()
    const second = subscribe()

    const run = replay([
      { type: "listener.added", subscription: first },
      { type: "menubar.seed-failed", attempt: 1, cause: new Error("closed") },
      { type: "listener.added", subscription: second },
      { type: "menubar.seeded", attempt: 2, items: [item("a")] },
    ])

    expect(run.effects.map((effect) => effect.type)).toEqual([
      "attach",
      "seed-menubar",
      "log-seed-error",
      "seed-menubar",
      "notify",
    ])
    expect(delivered(run.effects, [first, second])).toEqual([
      [0, ["a"]],
      [1, ["a"]],
    ])
  })
})

describe("attachment", () => {
  test("the same callback registered twice stays attached until both registrations stop", () => {
    const listener = () => undefined
    const first = { listener }
    const second = { listener }

    const one = replay([
      { type: "listener.added", subscription: first },
      { type: "listener.added", subscription: second },
      { type: "listener.removed", subscription: first },
    ])

    expect([...selectPluginSubscriptions(one.state)]).toEqual([second])
    expect(one.effects.some((effect) => effect.type === "detach")).toBe(false)

    const none = transitionPluginBridge(one.state, { type: "listener.removed", subscription: second })

    expect(none.state.status).toBe("detached")
    expect(none.effects).toEqual([{ type: "detach" }])
  })

  test("disposal detaches and ignores everything after it", () => {
    const first = subscribe()

    const run = replay([
      { type: "listener.added", subscription: first },
      { type: "disposed" },
      { type: "menubar.seeded", attempt: 1, items: [item("a")] },
      { type: "listener.added", subscription: subscribe() },
    ])

    expect(run.state.status).toBe("disposed")
    expect(run.effects.map((effect) => effect.type)).toEqual(["attach", "seed-menubar", "detach"])
  })
})
