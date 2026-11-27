import { describe, expect, test } from "bun:test"
import {
  DISPOSED_TYPEWRITER_EVENT,
  DISPOSED_TYPEWRITER_STATE,
  INITIAL_EMPTY_TYPEWRITER_STATE,
  selectTypewriterCursor,
  selectTypewriterDisplayed,
  transitionTypewriter,
  typingStepDelayMs,
  type TypewriterEvent,
  type TypewriterState,
  type TypewriterTransition,
} from "./typewriter-machine"

const run = (state: TypewriterState, ...events: TypewriterEvent[]) =>
  events.reduce<TypewriterTransition>((result, event) => transitionTypewriter(result.state, event), {
    state,
    effect: { type: "none" },
  })

const sync = (text: string | undefined, reducedMotion = false): TypewriterEvent => ({
  type: "sync",
  text,
  reducedMotion,
})

const step = (attempt = 1): TypewriterEvent => ({ type: "typing.step", attempt })

const lingerEnded = (attempt = 1): TypewriterEvent => ({ type: "linger.ended", attempt })

const view = (state: TypewriterState) => [selectTypewriterDisplayed(state), selectTypewriterCursor(state)]

describe("empty text", () => {
  test.each([undefined, ""])("mounting with %p renders nothing and arms nothing", (text) => {
    // Before the machine, an empty mount left a blinking cursor on screen forever.
    const next = transitionTypewriter(INITIAL_EMPTY_TYPEWRITER_STATE, sync(text))

    expect(next.state).toBe(INITIAL_EMPTY_TYPEWRITER_STATE)
    expect(next.effect).toEqual({ type: "none" })
    expect(view(next.state)).toEqual(["", "none"])
  })

  test("clearing the text mid-typing clears the partial text and the cursor", () => {
    // Before the machine, "Hel" and a solid cursor stayed on screen forever.
    const typing = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hello"), step(), step(), step())
    expect(view(typing.state)).toEqual(["Hel", "solid"])

    const cleared = transitionTypewriter(typing.state, sync(""))
    expect(cleared.state).toEqual({ status: "empty", attempts: 1 })
    expect(cleared.effect).toEqual({ type: "clear" })
    expect(view(cleared.state)).toEqual(["", "none"])
    expect(transitionTypewriter(cleared.state, step()).state).toBe(cleared.state)
  })

  test("clearing the text while the cursor lingers hides it at once", () => {
    const lingering = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"), step(), step())
    expect(lingering.state.status).toBe("lingering")

    const cleared = transitionTypewriter(lingering.state, sync(undefined))
    expect(cleared.effect).toEqual({ type: "clear" })
    expect(view(cleared.state)).toEqual(["", "none"])
    expect(transitionTypewriter(cleared.state, lingerEnded()).state).toBe(cleared.state)
  })

  test("clearing a finished text needs no timer to be cleared", () => {
    const done = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"), step(), step(), lingerEnded())
    const cleared = transitionTypewriter(done.state, sync(""))

    expect(cleared.state).toEqual({ status: "empty", attempts: 1 })
    expect(cleared.effect).toEqual({ type: "none" })
  })
})

describe("typing", () => {
  test("types each character behind a solid cursor, lingers with a blinking one, then hides it", () => {
    const started = transitionTypewriter(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"))
    expect(started.effect).toEqual({ type: "schedule", kind: "initial", attempt: 1 })
    expect(view(started.state)).toEqual(["", "solid"])

    const first = transitionTypewriter(started.state, step())
    expect(first.effect).toEqual({ type: "schedule", kind: "step", attempt: 1 })
    expect(view(first.state)).toEqual(["H", "solid"])

    const typed = transitionTypewriter(first.state, step())
    expect(typed.effect).toEqual({ type: "schedule", kind: "linger", attempt: 1 })
    expect(view(typed.state)).toEqual(["Hi", "blinking"])

    const done = transitionTypewriter(typed.state, lingerEnded())
    expect(done.effect).toEqual({ type: "none" })
    expect(view(done.state)).toEqual(["Hi", "none"])
  })

  test("the same text again changes nothing", () => {
    const typing = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"), step())
    expect(transitionTypewriter(typing.state, sync("Hi")).state).toBe(typing.state)

    const done = run(typing.state, step(), lingerEnded())
    expect(transitionTypewriter(done.state, sync("Hi")).state).toBe(done.state)
  })

  test("a new text restarts with a new attempt and ignores the old text's timers", () => {
    const replaced = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"), step(), sync("Bye"))

    expect(replaced.effect).toEqual({ type: "schedule", kind: "initial", attempt: 2 })
    expect(view(replaced.state)).toEqual(["", "solid"])
    expect(transitionTypewriter(replaced.state, step(1)).state).toBe(replaced.state)
    expect(view(transitionTypewriter(replaced.state, step(2)).state)).toEqual(["B", "solid"])
  })

  test("each timeout only applies to its own phase", () => {
    const typing = run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hi"))
    expect(transitionTypewriter(typing.state, lingerEnded()).state).toBe(typing.state)

    const lingering = run(typing.state, step(), step())
    expect(transitionTypewriter(lingering.state, step()).state).toBe(lingering.state)
    expect(transitionTypewriter(lingering.state, lingerEnded(2)).state).toBe(lingering.state)
  })

  test("never splits a surrogate pair", () => {
    // The old code sliced UTF-16 units, so "A🚀B" showed a lone surrogate for one step.
    const displayed = [0, 1, 2, 3].map((count) =>
      selectTypewriterDisplayed(
        run(INITIAL_EMPTY_TYPEWRITER_STATE, sync("A🚀B"), ...Array.from({ length: count }, () => step())).state,
      ),
    )

    expect(displayed).toEqual(["", "A", "A🚀", "A🚀B"])
  })

  test("step delays stay in their bands", () => {
    expect(typingStepDelayMs(0, 0)).toBe(150)
    expect(typingStepDelayMs(0.1, 1)).toBe(140)
    expect(typingStepDelayMs(0.5, 0.5)).toBe(55)
  })
})

describe("reduced motion", () => {
  test("shows the whole text at once without a cursor", () => {
    const next = transitionTypewriter(INITIAL_EMPTY_TYPEWRITER_STATE, sync("Hello", true))

    expect(next.state).toEqual({ status: "done", attempts: 0, text: "Hello" })
    expect(next.effect).toEqual({ type: "none" })
    expect(view(next.state)).toEqual(["Hello", "none"])
  })

  test.each([
    ["typing", [sync("Hi"), step()]],
    ["lingering", [sync("Hi"), step(), step()]],
  ] as const)("turning it on while %s finishes the text and clears the timer", (_, events) => {
    const next = transitionTypewriter(run(INITIAL_EMPTY_TYPEWRITER_STATE, ...events).state, sync("Hi", true))

    expect(next.effect).toEqual({ type: "clear" })
    expect(view(next.state)).toEqual(["Hi", "none"])
  })
})

describe("disposal", () => {
  test.each([
    ["typing", [sync("Hi")], "clear"],
    ["lingering", [sync("Hi"), step(), step()], "clear"],
    ["empty", [], "none"],
    ["done", [sync("Hi", true)], "none"],
  ] as const)("disposing while %s ends every later event", (_, events, effect) => {
    const disposed = transitionTypewriter(
      run(INITIAL_EMPTY_TYPEWRITER_STATE, ...events).state,
      DISPOSED_TYPEWRITER_EVENT,
    )

    expect(disposed.state).toBe(DISPOSED_TYPEWRITER_STATE)
    expect(disposed.effect).toEqual({ type: effect })
    ;[sync("Bye"), step(), lingerEnded(), DISPOSED_TYPEWRITER_EVENT].forEach((event) => {
      const next = transitionTypewriter(disposed.state, event)
      expect(next.state).toBe(disposed.state)
      expect(next.effect).toEqual({ type: "none" })
    })
  })
})
