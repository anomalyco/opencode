import { afterEach, expect, test, vi } from "bun:test"
import { createAnimatedPresence } from "../src/runtime/animated-presence"
import { batch, createRoot, createSignal } from "solid-js"

afterEach(() => vi.useRealTimers())

test("animates visibility changes without animating initial presence", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>("steer")
    const presence = createAnimatedPresence(value, () => null)

    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(false)
    expect(presence.value()).toBe("steer")
    expect(presence.present()).toBe(true)

    setValue("queue")
    expect(presence.animate()).toBe(false)
    expect(presence.value()).toBe("queue")

    setValue(undefined)
    expect(presence.show()).toBe(false)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("queue")

    setValue("steer")
    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("steer")

    dispose()
  })
})

test("animates the first appearance when initially hidden", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>()
    const presence = createAnimatedPresence(value, () => null)

    expect(presence.show()).toBe(false)
    expect(presence.animate()).toBe(false)
    expect(presence.present()).toBe(false)

    setValue("steer")
    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("steer")

    dispose()
  })
})

test("does not animate visibility changes across identities", () => {
  createRoot((dispose) => {
    const [identity, setIdentity] = createSignal("a")
    const [value, setValue] = createSignal<string | undefined>("visible")
    const presence = createAnimatedPresence(value, () => null, identity)

    expect(presence.animate()).toBe(false)
    batch(() => {
      setIdentity("b")
      setValue(undefined)
    })
    expect(presence.animate()).toBe(false)

    setValue("visible")
    expect(presence.animate()).toBe(true)
    dispose()
  })
})

test("holds brief appearances for the minimum duration before fading out", () => {
  vi.useFakeTimers()
  const state = createRoot((dispose) => {
    const [value, setValue] = createSignal<string>()
    const presence = createAnimatedPresence(value, () => null, undefined, 1000)
    return { presence, setValue, dispose }
  })

  expect(state.presence.show()).toBe(false)
  state.setValue("shell")
  vi.advanceTimersByTime(100)
  state.setValue(undefined)
  expect(state.presence.show()).toBe(true)
  expect(state.presence.present()).toBe(true)
  expect(state.presence.value()).toBe("shell")

  vi.advanceTimersByTime(899)
  expect(state.presence.show()).toBe(true)
  vi.advanceTimersByTime(1)
  expect(state.presence.show()).toBe(false)
  expect(state.presence.animate()).toBe(true)

  state.setValue("subagent")
  vi.advanceTimersByTime(1001)
  state.setValue(undefined)
  expect(state.presence.show()).toBe(false)
  state.dispose()
})

test("keeps the original deadline across updates and cancels pending dismissal when work resumes", () => {
  vi.useFakeTimers()
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string>("shell")
    const presence = createAnimatedPresence(value, () => null, undefined, 1000)

    vi.advanceTimersByTime(200)
    setValue("subagent")
    vi.advanceTimersByTime(200)
    setValue(undefined)
    vi.advanceTimersByTime(200)
    setValue("shell")
    vi.advanceTimersByTime(400)
    expect(presence.show()).toBe(true)
    expect(presence.value()).toBe("shell")

    setValue(undefined)
    expect(presence.show()).toBe(false)
    dispose()
  })
})

test("clears the minimum duration on identity changes", () => {
  vi.useFakeTimers()
  createRoot((dispose) => {
    const [identity, setIdentity] = createSignal("a")
    const [value, setValue] = createSignal<string>("shell")
    const presence = createAnimatedPresence(value, () => null, identity, 1000)

    setValue(undefined)
    expect(presence.show()).toBe(true)
    setIdentity("b")
    expect(presence.show()).toBe(false)
    expect(presence.animate()).toBe(false)
    expect(presence.value()).toBeUndefined()
    vi.advanceTimersByTime(1000)
    expect(presence.show()).toBe(false)

    setValue("subagent")
    setValue(undefined)
    expect(presence.show()).toBe(true)
    dispose()
    vi.advanceTimersByTime(1000)
    expect(presence.show()).toBe(true)
  })
})
