import { describe, expect, test } from "bun:test"
import {
  createHeroLoopState,
  HERO_MAX_DT_MS,
  selectHeroRedrawsStill,
  transitionHeroLoop,
  type HeroLoopState,
} from "./go-upsell-hero-machine"

const frame = (state: HeroLoopState, now: number) =>
  transitionHeroLoop(state, { type: "frame", attempt: state.status === "disposed" ? 0 : state.attempt, now })

const synced = (state: HeroLoopState, input: { reduced?: boolean; hidden?: boolean; now?: number }) =>
  transitionHeroLoop(state, {
    type: "synced",
    reduced: input.reduced ?? false,
    hidden: input.hidden ?? false,
    now: input.now ?? 0,
  })

describe("go upsell hero loop", () => {
  test("a first vsync timestamp before the loop started does not rewind art time", () => {
    const running = createHeroLoopState({ reduced: false, hidden: false, now: 120 })

    const early = frame(running, 112)
    expect(early).toMatchObject({ status: "running", time: 0, last: 112 })
    expect(frame(early, 128)).toMatchObject({ time: 16, last: 128 })
  })

  test("advances frames in place and caps a stalled frame", () => {
    const running = createHeroLoopState({ reduced: false, hidden: false, now: 0 })

    const next = frame(running, 5_000)
    expect(next).toBe(running)
    expect(next).toMatchObject({ time: HERO_MAX_DT_MS, last: 5_000 })
  })

  test("ignores a frame scheduled by an earlier run", () => {
    const running = createHeroLoopState({ reduced: false, hidden: false, now: 0 })
    const resumed = synced(synced(running, { hidden: true }), { now: 50 })

    expect(transitionHeroLoop(resumed, { type: "frame", attempt: 1, now: 66 })).toMatchObject({ time: 0, last: 50 })
  })

  test("a hidden page pauses instead of drawing the still, and shows the still again when it returns", () => {
    const running = frame(createHeroLoopState({ reduced: false, hidden: false, now: 0 }), 16)
    const paused = synced(running, { hidden: true })

    expect(paused).toEqual({ status: "paused", attempt: 2, time: 16 })
    expect(selectHeroRedrawsStill(paused)).toBe(false)

    const still = synced(paused, { reduced: true, hidden: true })
    expect(still).toBe(paused)
    expect(synced(still, { reduced: true })).toEqual({ status: "still", attempt: 3, time: 16 })
  })

  test("reduced motion stills a running loop and resumes art time where it stopped", () => {
    const running = frame(createHeroLoopState({ reduced: false, hidden: false, now: 0 }), 40)
    const still = synced(running, { reduced: true })

    expect(selectHeroRedrawsStill(still)).toBe(true)
    expect(synced(still, { reduced: true })).toBe(still)
    expect(synced(still, { now: 500 })).toEqual({ status: "running", attempt: 3, time: 40, last: 500 })
  })

  test("starts paused or still from the page it mounts on", () => {
    expect(createHeroLoopState({ reduced: true, hidden: true, now: 0 })).toEqual({
      status: "paused",
      attempt: 1,
      time: 0,
    })
    expect(createHeroLoopState({ reduced: true, hidden: false, now: 0 })).toEqual({
      status: "still",
      attempt: 1,
      time: 0,
    })
  })

  test("ignores everything once disposed", () => {
    const disposed = transitionHeroLoop(createHeroLoopState({ reduced: false, hidden: false, now: 0 }), {
      type: "disposed",
    })

    expect(disposed).toEqual({ status: "disposed" })
    expect(synced(disposed, { reduced: true })).toBe(disposed)
    expect(frame(disposed, 16)).toBe(disposed)
  })
})
