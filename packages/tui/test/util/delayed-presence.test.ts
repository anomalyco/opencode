import { expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createDelayedPresence } from "../../src/util/delayed-presence"

test("shows only after the same value remains present for the delay", async () => {
  jest.useFakeTimers()
  const scope = createRoot((dispose) => {
    const [value, setValue] = createSignal<string>()
    return { dispose, setValue, visible: createDelayedPresence(value, 1_000) }
  })

  try {
    scope.setValue("first")
    await Promise.resolve()
    jest.advanceTimersByTime(500)
    expect(scope.visible()).toBe(false)

    scope.setValue("second")
    await Promise.resolve()
    jest.advanceTimersByTime(999)
    expect(scope.visible()).toBe(false)
    jest.advanceTimersByTime(1)
    expect(scope.visible()).toBe(true)
  } finally {
    scope.dispose()
    jest.useRealTimers()
  }
})

test("cancels the delay when the value disappears or the owner is disposed", async () => {
  jest.useFakeTimers()
  const scope = createRoot((dispose) => {
    const [value, setValue] = createSignal<string>()
    return { dispose, setValue, visible: createDelayedPresence(value, 1_000) }
  })

  try {
    scope.setValue("running")
    await Promise.resolve()
    jest.advanceTimersByTime(500)
    scope.setValue(undefined)
    await Promise.resolve()
    jest.advanceTimersByTime(1_000)
    expect(scope.visible()).toBe(false)

    scope.setValue("running")
    await Promise.resolve()
    scope.dispose()
    jest.advanceTimersByTime(1_000)
    expect(scope.visible()).toBe(false)
  } finally {
    scope.dispose()
    jest.useRealTimers()
  }
})

test("uses the remaining delay for the current value", async () => {
  jest.useFakeTimers()
  const scope = createRoot((dispose) => {
    const [value, setValue] = createSignal<{ age: number }>()
    return {
      dispose,
      setValue,
      visible: createDelayedPresence(value, (current) => Math.max(0, 1_000 - current.age)),
    }
  })

  try {
    scope.setValue({ age: 400 })
    await Promise.resolve()
    jest.advanceTimersByTime(599)
    expect(scope.visible()).toBe(false)
    jest.advanceTimersByTime(1)
    expect(scope.visible()).toBe(true)

    scope.setValue({ age: 1_000 })
    await Promise.resolve()
    expect(scope.visible()).toBe(true)
  } finally {
    scope.dispose()
    jest.useRealTimers()
  }
})

test("does not restart the delay for an equivalent value", async () => {
  jest.useFakeTimers()
  const scope = createRoot((dispose) => {
    const [value, setValue] = createSignal<{ id: string }>()
    return {
      dispose,
      setValue,
      visible: createDelayedPresence(value, 1_000, (previous, next) => previous.id === next.id),
    }
  })

  try {
    scope.setValue({ id: "first" })
    await Promise.resolve()
    jest.advanceTimersByTime(500)
    scope.setValue({ id: "first" })
    await Promise.resolve()
    jest.advanceTimersByTime(499)
    expect(scope.visible()).toBe(false)
    jest.advanceTimersByTime(1)
    expect(scope.visible()).toBe(true)

    scope.setValue({ id: "second" })
    await Promise.resolve()
    expect(scope.visible()).toBe(false)
  } finally {
    scope.dispose()
    jest.useRealTimers()
  }
})
