import { describe, expect, test } from "bun:test"
import { State } from "../../src/project/state"

describe("project.state", () => {
  test("reset clears cached state", async () => {
    let calls = 0
    const key = `state-reset-${Math.random()}`
    const state = State.create(
      () => key,
      () => {
        calls++
        return calls
      },
    )

    expect(state()).toBe(1)
    expect(state()).toBe(1)
    expect(calls).toBe(1)

    await state.reset()

    expect(state()).toBe(2)
    expect(calls).toBe(2)
  })

  test("reset preserves other state entries for same key", async () => {
    let a = 0
    let b = 0
    const key = `state-shared-${Math.random()}`
    const first = State.create(
      () => key,
      () => {
        a++
        return a
      },
    )
    const second = State.create(
      () => key,
      () => {
        b++
        return b
      },
    )

    expect(first()).toBe(1)
    expect(second()).toBe(1)

    await first.reset()

    expect(first()).toBe(2)
    expect(second()).toBe(1)
  })

  test("reset runs dispose handler", async () => {
    let disposed = 0
    const key = `state-dispose-${Math.random()}`
    const state = State.create(
      () => key,
      () => ({ value: 1 }),
      async () => {
        disposed++
      },
    )

    state()
    await state.reset()

    expect(disposed).toBe(1)
  })

  test("reset is no-op when state has not been initialized", async () => {
    const key = `state-noop-${Math.random()}`
    const state = State.create(
      () => key,
      () => 1,
    )

    await state.reset()

    expect(state()).toBe(1)
  })
})
