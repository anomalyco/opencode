import { describe, expect, test } from "bun:test"
import { anySignal } from "./abort-signal"

describe("anySignal", () => {
  test("aborts with the reason of the first input to abort and releases the others", () => {
    const caller = new AbortController()
    const own = new AbortController()
    const listening = listeners(caller.signal)
    const signal = anySignal([caller.signal, own.signal])

    expect(signal.aborted).toBe(false)
    expect(listening.size).toBe(1)
    // A finished client subscription aborts its own controller; the caller's long-lived signal must not keep a listener.
    own.abort("done")
    expect(listening.size).toBe(0)
    caller.abort("caller")
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("done")
  })

  test("is already aborted when an input already is", () => {
    const open = new AbortController()
    const listening = listeners(open.signal)
    const signal = anySignal([open.signal, AbortSignal.abort("done")])

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("done")
    expect(listening.size).toBe(0)
  })
})

/** The abort listeners currently registered on `signal`, tracked around its real add and remove. */
function listeners(signal: AbortSignal) {
  const active = new Set<EventListenerOrEventListenerObject>()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)

  signal.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    if (type === "abort") active.add(listener)

    add(type, listener, options)
  }

  signal.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ) => {
    if (type === "abort") active.delete(listener)

    remove(type, listener, options)
  }

  return active
}
