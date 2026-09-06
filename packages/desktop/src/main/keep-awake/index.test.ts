import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { Layer, ManagedRuntime } from "effect"
import { KeepAwake } from "./index"

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

async function setup(initial?: unknown) {
  const starts: string[] = []
  const stops: number[] = []
  const writes: boolean[] = []
  const runtime = ManagedRuntime.make(
    Layer.effect(
      KeepAwake.Service,
      KeepAwake.make({
        power: {
          start: (type) => starts.push(type) - 1,
          stop: (id) => {
            stops.push(id)
            return true
          },
        },
        persistence: { read: () => initial, write: (value) => void writes.push(value) },
      }),
    ),
  )
  const dispose = () => runtime.dispose()
  disposers.push(dispose)
  return { awake: await runtime.runPromise(KeepAwake.Service), starts, stops, writes, dispose }
}

class Sender extends EventEmitter {
  destroyed = false
  constructor(readonly id: number) {
    super()
  }
  isDestroyed() {
    return this.destroyed
  }
}

describe("desktop keep awake", () => {
  test.each([undefined, false, null, "true", 1])("defaults off without an explicit opt-in: %p", async (initial) => {
    const { awake, starts, writes } = await setup(initial)
    awake.setActive(new Sender(1), true)
    expect(awake.getEnabled()).toBe(false)
    expect(starts).toEqual([])
    expect(writes).toEqual([])
  })

  test("applies a persisted opt-in only after an open tab reports activity", async () => {
    const { awake, starts, writes } = await setup(true)
    expect(awake.getEnabled()).toBe(true)
    expect(starts).toEqual([])
    awake.setActive(new Sender(1), true)
    expect(starts).toEqual(["prevent-app-suspension"])
    expect(writes).toEqual([])
  })

  test("enabling uses reports received while disabled, and disabling preserves them", async () => {
    const { awake, starts, stops, writes } = await setup()
    awake.setActive(new Sender(1), true)
    awake.setEnabled(true)
    expect(starts).toEqual(["prevent-app-suspension"])
    awake.setEnabled(false)
    expect(stops).toEqual([0])
    awake.setEnabled(true)
    expect(starts).toEqual(["prevent-app-suspension", "prevent-app-suspension"])
    expect(writes).toEqual([true, false, true])
  })

  test("releases when the last running tab closes, without waiting for the session", async () => {
    const { awake, starts, stops } = await setup(true)
    const sender = new Sender(1)
    awake.setActive(sender, true)
    awake.setActive(sender, false)
    expect(stops).toEqual([0])
    expect(sender.eventNames()).toEqual([])
    awake.setActive(sender, true)
    expect(starts).toHaveLength(2)
  })

  test("ORs activity across windows, independent of focus or visibility", async () => {
    const { awake, starts, stops } = await setup(true)
    const first = new Sender(1)
    const second = new Sender(2)
    awake.setActive(first, true)
    awake.setActive(second, false)
    awake.setActive(second, true)
    awake.setActive(first, false)
    expect(starts).toHaveLength(1)
    expect(stops).toEqual([])
    second.emit("destroyed")
    expect(stops).toEqual([0])
  })

  test("repeated reports and settings do not duplicate blockers or listeners", async () => {
    const { awake, starts, stops, writes } = await setup()
    const sender = new Sender(1)
    for (let i = 0; i < 100; i++) {
      awake.setEnabled(true)
      awake.setActive(sender, true)
    }
    expect(starts).toHaveLength(1)
    expect(writes).toEqual([true])
    expect(sender.listenerCount("destroyed")).toBe(1)
    expect(sender.listenerCount("render-process-gone")).toBe(1)
    expect(sender.listenerCount("did-start-navigation")).toBe(1)
    awake.setActive(sender, false)
    awake.setActive(sender, false)
    expect(stops).toEqual([0])
    expect(sender.eventNames()).toEqual([])
  })

  test.each(["destroyed", "render-process-gone"])("clears activity on %s", async (event) => {
    const { awake, stops } = await setup(true)
    const sender = new Sender(1)
    awake.setActive(sender, true)
    sender.emit(event)
    expect(stops).toEqual([0])
    expect(sender.eventNames()).toEqual([])
  })

  test("clears on main-frame reload/navigation, not app routes or subframes", async () => {
    const { awake, stops, starts } = await setup(true)
    const sender = new Sender(1)
    awake.setActive(sender, true)
    sender.emit("did-start-navigation", {}, "app://index/session", true, true)
    sender.emit("did-start-navigation", {}, "app://index/frame", false, false)
    expect(stops).toEqual([])
    sender.emit("did-start-navigation", {}, "app://index", false, true)
    expect(stops).toEqual([0])
    expect(sender.eventNames()).toEqual([])
    awake.setActive(sender, true)
    expect(starts).toHaveLength(2)
  })

  test("forgets disabled activity when its renderer closes", async () => {
    const { awake, starts } = await setup()
    const sender = new Sender(1)
    awake.setActive(sender, true)
    sender.emit("destroyed")
    awake.setEnabled(true)
    expect(starts).toEqual([])
  })

  test("ignores destroyed renderers", async () => {
    const { awake, starts } = await setup(true)
    const sender = new Sender(1)
    sender.destroyed = true
    awake.setActive(sender, true)
    expect(starts).toEqual([])
    expect(sender.eventNames()).toEqual([])
  })

  test("scope disposal releases the blocker and all listeners", async () => {
    const { awake, starts, stops, dispose } = await setup(true)
    const first = new Sender(1)
    const second = new Sender(2)
    awake.setActive(first, true)
    awake.setActive(second, true)
    await dispose()
    awake.dispose()
    awake.setActive(first, true)
    awake.setEnabled(false)
    awake.setEnabled(true)
    expect(starts).toHaveLength(1)
    expect(stops).toEqual([0])
    expect(first.eventNames()).toEqual([])
    expect(second.eventNames()).toEqual([])
  })
})
