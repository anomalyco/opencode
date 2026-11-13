import { expect, test } from "bun:test"
import { pinSpinPhase } from "./spin-phase"

test("pins only infinite loops to the timeline origin", () => {
  const animation = (iterations: number, startTime: number) => ({
    startTime,
    effect: { getTiming: () => ({ iterations }) },
  })

  const loops = [animation(Infinity, 1234), animation(Infinity, 87)]
  const fade = animation(1, 1234)

  pinSpinPhase({ getAnimations: () => [...loops, fade] })

  expect(loops.map((loop) => loop.startTime)).toEqual([0, 0])
  expect(fade.startTime).toBe(1234)
})
