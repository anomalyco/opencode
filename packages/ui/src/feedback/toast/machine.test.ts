import { describe, expect, test } from "bun:test"
import {
  createToastRegistryState,
  selectToastOptions,
  transitionToastRegistry,
  type ToastRegistryState,
} from "./machine"

type Options = { readonly label: string }

const shown = (key: string, liveIds: (number | string)[], label = key) =>
  ({
    type: "toast.shown",
    key,
    options: { label },
    liveIds: new Set(liveIds),
    topmostLiveId: liveIds.at(-1),
  }) as const

function show(state: ToastRegistryState<Options>, key: string, liveIds: (number | string)[], label = key) {
  return transitionToastRegistry(state, shown(key, liveIds, label))
}

describe("toast registry machine", () => {
  test("a toast closed directly in solid-sonner is pruned and shown again as a new toast", () => {
    const first = show(createToastRegistryState(), "saved", [])
    const other = show(first.state, "failed", [first.id])

    expect(first.id).toBe(-1)
    expect(other.state.entries.map((entry) => entry.key)).toEqual(["saved", "failed"])

    // Both were dismissed without callbacks (an unmounted region, a direct `toast.dismiss`), so neither is live.
    const again = show(other.state, "saved", [])

    expect(again.id).toBe(-3)
    expect(again.state.entries).toEqual([{ id: -3, key: "saved", options: { label: "saved" } }])
    expect(again.effects).toEqual([{ type: "sonner.publish", id: -3, options: { label: "saved" } }])
  })

  test("a released or dismissed toast has no actions left to run", () => {
    const first = show(createToastRegistryState(), "saved", [])

    expect(selectToastOptions(first.state, first.id)).toEqual({ label: "saved" })

    const released = transitionToastRegistry(first.state, { type: "toast.released", id: first.id })

    expect(selectToastOptions(released.state, first.id)).toBeUndefined()
    expect(released.effects).toEqual([])

    const dismissed = transitionToastRegistry(first.state, { type: "toast.dismissed", id: first.id })

    expect(selectToastOptions(dismissed.state, first.id)).toBeUndefined()
    expect(dismissed.effects).toEqual([{ type: "sonner.dismiss", id: first.id }])
  })

  test("a repeat of the front toast updates it in place and pulses it", () => {
    const first = show(createToastRegistryState(), "saved", [])
    const repeat = show(first.state, "saved", [first.id], "saved again")

    expect(repeat.id).toBe(first.id)
    expect(repeat.state.nextId).toBe(first.state.nextId)
    expect(selectToastOptions(repeat.state, first.id)).toEqual({ label: "saved again" })
    expect(repeat.effects).toEqual([
      { type: "sonner.publish", id: first.id, options: { label: "saved again" } },
      { type: "dom.pulse", id: first.id },
    ])
  })

  test("a repeat of a buried toast replaces it with a new toast in front", () => {
    const first = show(createToastRegistryState(), "saved", [])
    const other = show(first.state, "failed", [first.id])
    const repeat = show(other.state, "saved", [first.id, other.id])

    expect(repeat.id).toBe(-3)
    expect(repeat.state.entries.map((entry) => [entry.id, entry.key])).toEqual([
      [-2, "failed"],
      [-3, "saved"],
    ])
    expect(repeat.effects).toEqual([
      { type: "sonner.dismiss", id: first.id },
      { type: "sonner.publish", id: -3, options: { label: "saved" } },
    ])
  })

  test("custom toasts take ids from the same counter, and dismissing all clears every entry", () => {
    const custom = transitionToastRegistry(createToastRegistryState<Options>(), { type: "custom.shown" })

    expect(custom.state.nextId).toBe(-1)
    expect(custom.effects).toEqual([])

    const first = show(custom.state, "saved", [custom.state.nextId])

    expect(first.id).toBe(-2)

    const all = transitionToastRegistry(first.state, { type: "toast.dismissed" })

    expect(all.state).toEqual({ nextId: -2, entries: [] })
    expect(all.effects).toEqual([{ type: "sonner.dismiss", id: undefined }])
  })

  test("releasing an unknown toast keeps the state", () => {
    const first = show(createToastRegistryState(), "saved", [])

    expect(transitionToastRegistry(first.state, { type: "toast.released", id: -9 }).state).toBe(first.state)
  })
})
