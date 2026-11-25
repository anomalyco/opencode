import { afterEach, expect, jest, setSystemTime, test } from "bun:test"
import { createAnimatedPresence } from "../src/runtime/animated-presence"
import { batch, createRoot, createSignal } from "solid-js"

afterEach(() => {
  setSystemTime()
  jest.useRealTimers()
})

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

test("keeps a value shown for the minimum duration", () => {
  jest.useFakeTimers()
  setSystemTime(new Date(100))

  // The presence's effects and timers start once the root has run, as they do for a mounted component.
  const view = createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>("hint")

    return {
      dispose,
      setValue,
      presence: createAnimatedPresence(
        value,
        () => null,
        () => "ses_A",
        1000,
      ),
    }
  })

  setSystemTime(new Date(250))
  view.setValue(undefined)
  expect(view.presence.show()).toBe(true)
  expect(view.presence.present()).toBe(true)
  expect(view.presence.value()).toBe("hint")

  jest.advanceTimersByTime(849)
  expect(view.presence.show()).toBe(true)
  jest.advanceTimersByTime(1)
  expect(view.presence.show()).toBe(false)
  expect(view.presence.animate()).toBe(true)
  expect(view.presence.present()).toBe(false)
  view.dispose()
})

test("drops a running exit when the identity changes", () => {
  const element = document.createElement("div")
  document.body.append(element)

  const view = createRoot((dispose) => {
    const [identity, setIdentity] = createSignal("ses_A")
    const [value, setValue] = createSignal<string | undefined>("visible")

    return { dispose, setIdentity, setValue, presence: createAnimatedPresence(value, () => element, identity) }
  })

  element.style.animationName = "exit"
  view.setValue(undefined)
  expect(view.presence.present()).toBe(true)
  expect(view.presence.animate()).toBe(true)

  // The new identity removes the exit classes; nothing will end the old exit.
  element.style.animationName = "none"
  view.setIdentity("ses_B")
  expect(view.presence.present()).toBe(false)
  expect(view.presence.animate()).toBe(false)
  expect(view.presence.value()).toBeUndefined()
  view.dispose()
  element.remove()
})
