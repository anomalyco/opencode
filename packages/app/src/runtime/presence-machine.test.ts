import { describe, expect, test } from "bun:test"
import {
  countNewAnimations,
  createAnimatedPresenceState,
  createPresenceState,
  DISPOSED_ANIMATED_EVENT,
  DISPOSED_PRESENCE_EVENT,
  ELEMENT_CHANGED_EVENT,
  hasCssToken,
  HIDE_INSTANT_EVENT,
  maxCssTimeMs,
  REDUCED_PRESENCE_EVENT,
  selectAnimatedAnimate,
  selectAnimatedShow,
  selectAnimatedValue,
  selectPresencePhase,
  selectPresent,
  SHOW_PRESENCE_EVENT,
  TRANSITION_END_EVENT,
  transitionAnimatedPresence,
  transitionPresence,
  type AnimatedPresenceEvent,
  type AnimatedPresenceState,
  type PresenceEvent,
  type PresenceState,
} from "./presence-machine"

const replay = (state: PresenceState, ...events: PresenceEvent[]) => events.reduce(transitionPresence, state)

const animation = (names: string, count = 1, timeoutMs = 300): PresenceEvent => ({
  type: "hide",
  exit: { kind: "animation", names, count, timeoutMs },
})

const transition = (count: number, timeoutMs = 250): PresenceEvent => ({
  type: "hide",
  exit: { kind: "transition", count, timeoutMs },
})

const started = (name: string, current = name): PresenceEvent => ({ type: "animation.started", name, current })

const ended = (name: string): PresenceEvent => ({ type: "animation.ended", name })

const timeout = (attempt: number): PresenceEvent => ({ type: "timeout", attempt })

const phase = (state: PresenceState) => selectPresencePhase(state)

describe("transitionPresence", () => {
  test("hides on the fallback timer when no end event arrives, and ignores a stale timer", () => {
    const hiding = replay(createPresenceState(true), animation("exit"))
    expect(hiding).toMatchObject({ status: "hiding", attempt: 1, timeoutMs: 300 })
    expect(transitionPresence(hiding, timeout(0))).toBe(hiding)
    expect(phase(transitionPresence(hiding, timeout(1)))).toBe("hidden")

    // A timer from an earlier exit cannot cut the next one short.
    const again = replay(hiding, SHOW_PRESENCE_EVENT, animation("exit"))
    expect(again).toMatchObject({ status: "hiding", attempt: 2 })
    expect(transitionPresence(again, timeout(1))).toBe(again)
  })

  test("hides at once when the element is swapped or unmounted mid-exit", () => {
    const hiding = replay(createPresenceState(true), animation("exit"))
    expect(phase(transitionPresence(hiding, ELEMENT_CHANGED_EVENT))).toBe("hidden")
  })

  test("forgets the old element's animation when the element changes while present", () => {
    const pulsing = replay(createPresenceState(true), started("pulse"))
    expect(pulsing).toMatchObject({ status: "present", started: "pulse" })

    const swapped = transitionPresence(pulsing, ELEMENT_CHANGED_EVENT)
    expect(swapped).toMatchObject({ status: "present", started: "none" })
    // The new element's exit is named like the old element's running animation; it still has to play.
    expect(transitionPresence(swapped, animation("pulse"))).toMatchObject({ status: "hiding", ignore: "none" })
    expect(transitionPresence(createPresenceState(true), ELEMENT_CHANGED_EVENT)).toEqual(createPresenceState(true))
  })

  test("hides at once on an instant hide mid-exit, as on an identity switch", () => {
    const hiding = replay(createPresenceState(true), animation("exit"))
    expect(phase(transitionPresence(hiding, HIDE_INSTANT_EVENT))).toBe("hidden")
    // A second measured hide while hiding keeps the exit already running.
    expect(transitionPresence(hiding, animation("other"))).toBe(hiding)
  })

  test("waits for every transition of a transition exit", () => {
    const hiding = replay(createPresenceState(true), transition(2))
    expect(hiding).toMatchObject({ status: "hiding", kind: "transition", pending: 2 })

    expect(transitionPresence(hiding, TRANSITION_END_EVENT)).toBe(hiding)
    expect(hiding).toMatchObject({ status: "hiding", pending: 1 })
    expect(phase(transitionPresence(hiding, TRANSITION_END_EVENT))).toBe("hidden")
    // Animation ends do not settle a transition exit.
    expect(transitionPresence(replay(createPresenceState(true), transition(1)), ended("exit")).status).toBe("hiding")
  })

  test("matches animation names exactly", () => {
    const hiding = replay(createPresenceState(true), animation("fade-out-exit"))
    expect(transitionPresence(hiding, ended("fade-out"))).toBe(hiding)
    expect(transitionPresence(hiding, ended("exit"))).toBe(hiding)
    expect(phase(transitionPresence(hiding, ended("fade-out-exit")))).toBe("hidden")
  })

  test("ignores the end of an animation that was running before the hide", () => {
    const hiding = replay(createPresenceState(true), started("spin", "spin"), animation("spin, exit", 1))
    expect(hiding).toMatchObject({ ignore: "spin", pending: 1 })
    expect(transitionPresence(hiding, ended("spin"))).toBe(hiding)
    expect(phase(transitionPresence(hiding, ended("exit")))).toBe("hidden")
  })

  test("waits for every exit animation", () => {
    const hiding = replay(createPresenceState(true), animation("fade-out, slide-out", 2))
    expect(transitionPresence(hiding, ended("fade-out"))).toBe(hiding)
    expect(transitionPresence(hiding, ended("slide-out"))).toMatchObject({ status: "hidden" })
  })

  test("does not record a start whose animation is no longer applied", () => {
    const present = createPresenceState(true)
    expect(transitionPresence(present, started("enter", "none"))).toBe(present)
    const entering = transitionPresence(present, started("enter"))
    expect(transitionPresence(entering, started("enter"))).toBe(entering)
  })

  test("hides at once when Reduce Motion turns on mid-exit", () => {
    const hiding = replay(createPresenceState(true), animation("exit"))
    expect(phase(transitionPresence(hiding, REDUCED_PRESENCE_EVENT))).toBe("hidden")
    const present = createPresenceState(true)
    expect(transitionPresence(present, REDUCED_PRESENCE_EVENT)).toBe(present)
  })

  test("comes back when shown during an exit, and late end events do not hide it", () => {
    const shown = replay(createPresenceState(true), animation("exit"), SHOW_PRESENCE_EVENT)
    expect(shown).toMatchObject({ status: "present", started: "none" })
    expect(transitionPresence(shown, ended("exit"))).toBe(shown)
    expect(transitionPresence(shown, TRANSITION_END_EVENT)).toBe(shown)
    expect(transitionPresence(shown, timeout(1))).toBe(shown)
  })

  test("ignores events that do not apply", () => {
    const hidden = createPresenceState(false)
    const present = createPresenceState(true)
    const ignored: PresenceEvent[] = [HIDE_INSTANT_EVENT, ended("exit"), TRANSITION_END_EVENT, timeout(0), started("x")]
    ignored.forEach((event) => expect(transitionPresence(hidden, event)).toBe(hidden))
    expect(transitionPresence(present, SHOW_PRESENCE_EVENT)).toBe(present)
    expect(transitionPresence(present, ended("exit"))).toBe(present)
    expect(transitionPresence(present, timeout(0))).toBe(present)
  })

  test("stays disposed from every phase", () => {
    const states = [
      createPresenceState(true),
      createPresenceState(false),
      replay(createPresenceState(true), animation("exit")),
    ]

    states.forEach((state) => {
      const disposed = transitionPresence(state, DISPOSED_PRESENCE_EVENT)
      expect(selectPresent(disposed)).toBe(false)
      expect(phase(disposed)).toBe("hidden")
      expect(transitionPresence(disposed, SHOW_PRESENCE_EVENT)).toBe(disposed)
      expect(transitionPresence(disposed, animation("exit"))).toBe(disposed)
    })
  })
})

const sync = <T>(
  value: T | undefined,
  now: number,
  options: { identity?: unknown; minimumDuration?: number } = {},
): AnimatedPresenceEvent<T> => ({
  type: "sync",
  value,
  identity: options.identity,
  hasIdentity: "identity" in options,
  minimumDuration: options.minimumDuration ?? 0,
  now,
})

const view = <T>(state: AnimatedPresenceState<T>) => ({
  show: selectAnimatedShow(state),
  animate: selectAnimatedAnimate(state),
  value: selectAnimatedValue(state),
})

describe("transitionAnimatedPresence", () => {
  test("lingers for the rest of the minimum duration and hides once it elapses", () => {
    const shown = createAnimatedPresenceState("hint", "ses_A", 100)
    const lingering = transitionAnimatedPresence(shown, sync(undefined, 250.3, { identity: "ses_A", minimumDuration: 1000 }))
    expect(lingering).toMatchObject({ status: "lingering", attempt: 1 })
    expect(lingering.status === "lingering" && lingering.delayMs).toBeCloseTo(849.7)
    expect(view(lingering)).toEqual({ show: true, animate: false, value: "hint" })

    // Further syncs with no value keep the running linger rather than starting another.
    expect(transitionAnimatedPresence(lingering, sync(undefined, 1099.3, { identity: "ses_A", minimumDuration: 1000 }))).toBe(
      lingering,
    )
    const hidden = transitionAnimatedPresence(lingering, { type: "linger.elapsed", attempt: 1 })
    expect(view(hidden)).toEqual({ show: false, animate: true, value: "hint" })
  })

  test("a value returning mid-linger cancels it, and its timer cannot end the next linger", () => {
    const options = { identity: "ses_A", minimumDuration: 1000 }
    const first = transitionAnimatedPresence(createAnimatedPresenceState("hint", "ses_A", 0), sync(undefined, 100, options))
    const back = transitionAnimatedPresence(first, sync("hint", 200, options))
    expect(view(back)).toEqual({ show: true, animate: false, value: "hint" })
    expect(transitionAnimatedPresence(back, { type: "linger.elapsed", attempt: 1 })).toBe(back)

    const second = transitionAnimatedPresence(back, sync(undefined, 300, options))
    expect(second).toMatchObject({ status: "lingering", attempt: 2, delayMs: 700 })
    expect(transitionAnimatedPresence(second, { type: "linger.elapsed", attempt: 1 })).toBe(second)
  })

  test("an identity switch mid-exit drops the exit and the previous value", () => {
    const hiding = transitionAnimatedPresence(createAnimatedPresenceState("val", "ses_A", 0), sync(undefined, 10, { identity: "ses_A" }))
    expect(view(hiding)).toEqual({ show: false, animate: true, value: "val" })

    const switched = transitionAnimatedPresence(hiding, sync(undefined, 20, { identity: "ses_B" }))
    expect(view(switched)).toEqual({ show: false, animate: false, value: undefined })

    const lingering = transitionAnimatedPresence(
      createAnimatedPresenceState("val", "ses_A", 0),
      sync(undefined, 10, { identity: "ses_A", minimumDuration: 1000 }),
    )
    const moved = transitionAnimatedPresence(lingering, sync(undefined, 20, { identity: "ses_B", minimumDuration: 1000 }))
    expect(view(moved)).toEqual({ show: false, animate: false, value: undefined })
    expect(transitionAnimatedPresence(moved, { type: "linger.elapsed", attempt: 1 })).toBe(moved)
  })

  test("animates changes after the first, without an identity", () => {
    const shown = createAnimatedPresenceState("steer", undefined, 0)
    expect(transitionAnimatedPresence(shown, sync("steer", 1))).toBe(shown)
    const hidden = transitionAnimatedPresence(shown, sync(undefined, 1))
    expect(view(hidden)).toEqual({ show: false, animate: true, value: "steer" })
    expect(transitionAnimatedPresence(hidden, sync(undefined, 2))).toBe(hidden)
    expect(view(transitionAnimatedPresence(hidden, sync("queue", 2)))).toEqual({ show: true, animate: true, value: "queue" })
  })

  test("stays disposed", () => {
    const states = [
      createAnimatedPresenceState("hint", "a", 0),
      createAnimatedPresenceState<string>(undefined, "a", 0),
      transitionAnimatedPresence(createAnimatedPresenceState("hint", "a", 0), sync(undefined, 1, { identity: "a", minimumDuration: 100 })),
    ]

    states.forEach((state) => {
      const disposed = transitionAnimatedPresence(state, DISPOSED_ANIMATED_EVENT)
      expect(view(disposed)).toEqual({ show: false, animate: false, value: undefined })
      expect(transitionAnimatedPresence(disposed, sync("hint", 2, { identity: "a" }))).toBe(disposed)
    })
  })
})

describe("CSS lists", () => {
  test("hasCssToken matches whole comma-separated tokens", () => {
    expect(hasCssToken("fade-out-exit", "fade-out")).toBe(false)
    expect(hasCssToken("enter, fade-out ,exit", "fade-out")).toBe(true)
    expect(hasCssToken("enter,exit", "exit")).toBe(true)
    expect(hasCssToken("none", "none")).toBe(false)
    expect(hasCssToken("", "exit")).toBe(false)
  })

  test("countNewAnimations skips none and animations already running", () => {
    expect(countNewAnimations("none", "none")).toBe(0)
    expect(countNewAnimations("spin, exit", "spin")).toBe(1)
    expect(countNewAnimations("fade-out, slide-out", "none")).toBe(2)
    expect(countNewAnimations("", "none")).toBe(0)
  })

  test("maxCssTimeMs adds the repeating delay list to each duration", () => {
    expect(maxCssTimeMs("0.2s, 150ms", "0s")).toBe(200)
    expect(maxCssTimeMs("100ms, 300ms", "50ms, -200ms")).toBe(150)
    expect(maxCssTimeMs("1s", "")).toBe(1000)
    expect(maxCssTimeMs("", "")).toBe(0)
    expect(maxCssTimeMs("100ms", "-1s")).toBe(0)
  })
})
