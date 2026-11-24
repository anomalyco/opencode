import { expect, test } from "bun:test"
import { pinSpinPhase } from "./spin-phase"

test("pins only running infinite loops to the timeline origin without touching already-pinned or paused ones", () => {
  let timingCalls = 0

  const animation = (iterations: number, startTime: number, playState?: AnimationPlayState) => ({
    startTime,
    playState,
    effect: {
      getTiming: () => {
        timingCalls++

        return { iterations }
      },
    },
  })

  const loops = [animation(Infinity, 1234, "running"), animation(Infinity, 87, "running")]
  const alreadyPinned = animation(Infinity, 0, "running")
  const paused = animation(Infinity, 500, "paused")
  const fade = animation(1, 1234, "running")

  pinSpinPhase({ getAnimations: () => [...loops, alreadyPinned, paused, fade] })

  expect(loops.map((loop) => loop.startTime)).toEqual([0, 0])
  expect(alreadyPinned.startTime).toBe(0)
  expect(paused.startTime).toBe(500)
  expect(fade.startTime).toBe(1234)
  // Already-pinned and paused animations short-circuit before calling getTiming().
  expect(timingCalls).toBe(3)
})
