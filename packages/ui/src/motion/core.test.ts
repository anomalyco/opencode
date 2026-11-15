import { describe, expect, it, mock, spyOn } from "bun:test"
import { Spring } from "./spring"
import { createFrameLoop } from "./loop"
import { VelocityTracker } from "./velocity"
import { sliderFraction, sliderStep, sliderStops, sliderValue } from "./slider"

describe("Spring", () => {
  it("settles to the exact target, retaining velocity on interruption", () => {
    const spring = new Spring(0).set(200)
    spring.step(0.1)
    const velocity = spring.velocity
    spring.set(-40)
    expect(spring.velocity).toBe(velocity)

    for (let i = 0; i < 240; i++) spring.step(1 / 60)
    expect(spring.value).toBe(-40)
    expect(spring.velocity).toBe(0)
    expect(spring.resting).toBe(true)
  })
  it("does not overshoot at bounce zero", () => {
    const spring = Spring.fromDuration(0, { duration: 0.42, bounce: 0 }).set(1)

    for (let i = 0; i < 240; i++) {
      expect(spring.step(1 / 120)).toBeLessThanOrEqual(1)
      expect(spring.value).toBeGreaterThanOrEqual(0)
    }

    expect(spring.value).toBe(1)
  })
  it("bounce .3 produces the harmonic oscillator overshoot (~4.6%)", () => {
    const spring = Spring.fromDuration(0, { duration: 0.42, bounce: 0.3 }).set(1)
    let peak = 0

    for (let i = 0; i < 480; i++) peak = Math.max(peak, spring.step(1 / 480))
    const expected = Math.exp((-Math.PI * 0.7) / Math.sqrt(1 - 0.7 ** 2))
    expect(peak - 1).toBeCloseTo(expected, 2)
  })
  it.each([0.2, 0.42, 0.8])("has perceptual 2%% settle time near duration %s (not a hard timeout)", (duration) => {
    const spring = Spring.fromDuration(0, { duration, bounce: 0 }).set(1)
    let t = 0

    while (spring.value < 0.98) {
      spring.step(1 / 480)
      t += 1 / 480
    }

    expect(t / duration).toBeGreaterThan(0.9)
    expect(t / duration).toBeLessThan(1.1)
  })
  it("matches 60 and 120 Hz frame partitioning", () => {
    const a = new Spring(0).set(100)
    const b = new Spring(0).set(100)

    for (let i = 0; i < 12; i++) {
      a.step(1 / 60)
      b.step(1 / 120)
      b.step(1 / 120)
    }

    expect(a.value).toBeCloseTo(b.value, 10)
    expect(a.velocity).toBeCloseTo(b.velocity, 10)
  })
  it("clamps suspension dt and rejects invalid parameters", () => {
    const a = new Spring(0).set(100)
    const b = new Spring(0).set(100)
    expect(a.step(30)).toBe(b.step(0.1))
    expect(a.step(-1)).toBe(a.value)
    expect(() => a.set(NaN)).toThrow(RangeError)
    expect(() => new Spring(0, { omega: 0 })).toThrow(RangeError)
    expect(() => Spring.fromDuration(0, { duration: 0, bounce: 0 })).toThrow(RangeError)
    expect(() => Spring.fromDuration(0, { duration: 0.42, bounce: 1 })).toThrow(RangeError)
    expect(() => Spring.fromDuration(0, { duration: 0.42, bounce: -0.3 })).toThrow(RangeError)
    expect(() => new Spring(0, { omega: 240, zeta: 2 })).toThrow(RangeError)
  })
  it("matches native SwiftUI stiffness and damping", () => {
    const spring = Spring.fromDuration(0, { duration: 0.42, bounce: 0.18 })
    expect(spring.omega ** 2).toBeCloseTo(223.80055331268386, 10)
    expect(2 * spring.zeta * spring.omega).toBeCloseTo(24.534342628034576, 10)
  })
  it("tracks the 480 Hz reference integrator across underdamped, critical, and overdamped regimes", () => {
    const regimes = [
      { omega: 26, zeta: 0.7 },
      { omega: 26, zeta: 1 },
      { omega: 26, zeta: 1 + 1e-9 },
      { omega: 20, zeta: 1.4 },
    ]

    for (const cfg of regimes) {
      const spring = new Spring(0, cfg).set(100)
      let refValue = 0
      let refVelocity = 0
      const stiffness = cfg.omega * cfg.omega
      const damping = 2 * cfg.zeta * cfg.omega
      let maxDiff = 0

      for (let frame = 0; frame < 180; frame++) {
        if (frame === 15) {
          spring.set(-50)
        }

        const target = frame < 15 ? 100 : -50

        for (let i = 0; i < 8; i++) {
          const h = 1 / 480
          refVelocity += (-stiffness * (refValue - target) - damping * refVelocity) * h
          refValue += refVelocity * h
        }

        spring.step(1 / 60)
        maxDiff = Math.max(maxDiff, Math.abs(spring.value - refValue))
      }

      // First-order 480 Hz Euler lag over a 150-unit sweep is within ~2% of travel, and both settle to target.
      expect(maxDiff).toBeLessThan(3.5)
      expect(spring.value).toBe(-50)
      expect(spring.velocity).toBe(0)
      expect(spring.resting).toBe(true)
    }
  })
})

function scheduler() {
  let id = 0
  const pending = new Map<number, (time: number) => void>()

  return {
    pending,
    request: (fn: (time: number) => void) => {
      pending.set(++id, fn)

      return id
    },
    cancel: (key: number) => {
      pending.delete(key)
    },
    frame: (time: number) => {
      const callbacks = [...pending.values()]
      pending.clear()

      for (const callback of callbacks) callback(time)
    },
  }
}

describe("frame loop", () => {
  it("sleeps, wakes once, and clamps suspension time", () => {
    const clock = scheduler()
    const loop = createFrameLoop(clock)
    const values: number[] = []

    const remove = loop.add((dt) => {
      values.push(dt)

      return true
    })

    loop.add(() => false)
    expect(clock.pending.size).toBe(1)
    clock.frame(1000)
    clock.frame(4000)
    expect(values).toEqual([1 / 60, 0.1])
    remove()
    expect(clock.pending.size).toBe(0)
    loop.add((dt) => {
      expect(dt).toBe(1 / 60)

      return false
    })
    clock.frame(9000)
    expect(clock.pending.size).toBe(0)
  })
  it("can remove the next job, add a job, and remove itself mid-frame", () => {
    const clock = scheduler()
    const loop = createFrameLoop(clock)
    const calls: string[] = []

    const first = loop.add(() => {
      calls.push("a")
      second()
      first()
      loop.add(() => {
        calls.push("c")

        return false
      })

      return true
    })

    const second = loop.add(() => {
      calls.push("b")

      return false
    })

    clock.frame(0)
    expect(calls).toEqual(["a"])
    clock.frame(16)
    expect(calls).toEqual(["a", "c"])
    expect(clock.pending.size).toBe(0)
  })
  it("batches every read before every write, and skips removed writes", () => {
    const clock = scheduler()
    const loop = createFrameLoop(clock)
    const calls: string[] = []
    loop.addMeasured(
      () => {
        calls.push("read a")
      },
      () => {
        calls.push("write a")

        return false
      },
    )
    loop.addMeasured(
      () => {
        calls.push("read b")
      },
      () => {
        calls.push("write b")

        return false
      },
    )
    clock.frame(0)
    expect(calls).toEqual(["read a", "read b", "write a", "write b"])
  })
  it("removes jobs during the read phase without breaking traversal", () => {
    const clock = scheduler(),
      loop = createFrameLoop(clock),
      calls: string[] = []

    loop.addMeasured(
      () => {
        remove()
      },
      () => {
        calls.push("a")

        return false
      },
    )

    const remove = loop.addMeasured(
      () => {
        calls.push("read b")
      },
      () => {
        calls.push("b")

        return false
      },
    )

    loop.add(() => {
      calls.push("c")

      return false
    })
    clock.frame(0)
    expect(calls).toEqual(["a", "c"])
    expect(clock.pending.size).toBe(0)
  })
  it("removes a throwing job and lets other jobs complete next frame", () => {
    const clock = scheduler(),
      loop = createFrameLoop(clock),
      done = mock(() => false)

    loop.add(() => {
      throw new Error("broken job")
    })
    loop.add(done)
    expect(() => clock.frame(0)).toThrow("broken job")
    clock.frame(16)
    expect(done).toHaveBeenCalledTimes(1)
    expect(clock.pending.size).toBe(0)
  })
})

describe("velocity tracker", () => {
  it("uses recent samples in px/s and becomes stale after a pause", () => {
    const tracker = new VelocityTracker()
    const clock = spyOn(performance, "now").mockReturnValue(180)
    tracker.push(0, 0, 0)
    tracker.push(90, 45, 90)
    tracker.push(180, 90, 180)
    expect(tracker.velocity()).toEqual({ x: 1000, y: 500 })
    clock.mockReturnValue(300)
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 })
    tracker.reset()
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 })
    clock.mockRestore()
  })
  it("handles duplicate timestamps, reversed clocks, and the ring wrapping", () => {
    const tracker = new VelocityTracker()
    const clock = spyOn(performance, "now").mockReturnValue(50)
    tracker.push(10, 0, 20)
    tracker.push(15, 0, 20)
    expect(tracker.velocity().x).toBe(0)
    tracker.push(0, 0, 0)
    expect(tracker.velocity().x).toBe(0)

    for (let i = 0; i <= 200; i++) tracker.push(i / 4, 0, i / 4)
    expect(tracker.velocity().x).toBe(1000)
    clock.mockRestore()
  })
})

describe("slider math", () => {
  it("counts actual stops, rounds relative to min and clamps", () => {
    const spec = { min: 1, max: 5, step: 1 }
    expect(sliderStops(spec)).toBe(5)
    expect(sliderValue(spec, 2.6)).toBe(3)
    expect(sliderValue(spec, 20)).toBe(5)
    expect(sliderFraction(spec, 3)).toBe(0.5)
    expect(sliderStops({ min: 0, max: 0.9, step: 0.1 })).toBe(10)
  })
  it("supports decimals, singleton ranges and final partial steps", () => {
    expect(sliderValue({ min: 0.1, max: 1, step: 0.1 }, 0.31)).toBe(0.3)
    expect(sliderStops({ min: 0, max: 1, step: 0.3 })).toBe(5)
    expect(sliderValue({ min: 0, max: 1, step: 0.3 }, 0.98)).toBe(1)
    expect(sliderStep({ min: 0, max: 1, step: 0.3 }, 1, -1)).toBe(0.9)
    expect(sliderStep({ min: 0, max: 1, step: 0.3 }, 0.9, 1)).toBe(1)
    expect(sliderFraction({ min: 2, max: 2, step: 1 }, 2)).toBe(0)
    expect(() => sliderStops({ min: 1, max: 2, step: 0 })).toThrow(RangeError)
  })
})
