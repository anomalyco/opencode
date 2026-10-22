import { describe, expect, spyOn, test } from "bun:test"
import { frameLoop } from "@opencode/ui/motion"
import { createRowGrowth, streamingEdgeFor, workingHandoffPose } from "./row-growth"

function setup() {
  const wrapper = document.createElement("div")
  const sizes: number[] = []
  const frames: { pending: number; held: number }[] = []

  const growth = createRowGrowth({
    measure: () => {},
    resize: (key, size) => {
      if (key !== "row") return false
      sizes.push(size)

      return wrapper
    },
    below: () => true,
    settle: (state) => frames.push(state),
  })

  return { growth, sizes, wrapper, frames }
}

async function settle(growth: ReturnType<typeof createRowGrowth>, frames: { held: number }[]) {
  const deadline = performance.now() + 3000

  while ((growth.target("row") !== undefined || frames.at(-1)?.held !== 0) && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 16))
}

describe("row growth", () => {
  test.each([
    { backlog: 0, replyFirst: true },
    { backlog: 800, replyFirst: true },
    { backlog: 800, replyFirst: false },
  ])("opens arrivals without changing the stream's pace (%j)", ({ backlog, replyFirst }) => {
    const sizes = new Map<string, number>()
    const reply: number[] = []
    const wrappers = new Map<string, HTMLDivElement>()
    const schedule = spyOn(frameLoop, "addMeasured").mockImplementation(() => () => {})
    const growth = createRowGrowth({
      measure: () => {},
      resize: (key, size) => {
        sizes.set(key, size)
        if (key === "reply") reply.push(size)
        const wrapper = wrappers.get(key) ?? document.createElement("div")
        wrappers.set(key, wrapper)
        return wrapper
      },
      below: () => true,
      settle: () => {},
    })

    try {
      if (replyFirst) growth.grow("reply", 0, 400, false, undefined, true)
      growth.grow("tools", 0, 44, true)
      growth.grow("gap", 0, 4, true)
      if (backlog) growth.grow("later", 0, backlog, true)
      if (!replyFirst) growth.grow("reply", 0, 400, false, undefined, true)
      const advance = schedule.mock.calls[0]![1]
      advance(1 / 60)
      expect(sizes.get("reply")).toBeGreaterThan(0)
      expect(sizes.get("tools")).toBeGreaterThan(0)
      expect(sizes.get("tools")).toBeLessThan(3)
      if (backlog) expect(sizes.get("later")).toBeGreaterThan(0)
      Array.from({ length: 180 }, () => advance(1 / 60))
      expect(Math.max(...reply.map((size, index) => size - (reply[index - 1] ?? 0)))).toBeLessThanOrEqual(16)
      expect(growth.target("gap")).toBeUndefined()
      expect(wrappers.get("gap")!.style.opacity).toBe("")
      expect(growth.growing()).toBe(false)
    } finally {
      growth.finish()
      schedule.mockRestore()
    }
  })

  test("keeps a streaming row's catch-up pace when its final height arrives", () => {
    const sizes: number[] = []
    const schedule = spyOn(frameLoop, "addMeasured").mockImplementation(() => () => {})
    const growth = createRowGrowth({
      measure: () => {},
      resize: (_, size) => {
        sizes.push(size)
      },
      below: () => true,
      settle: () => {},
    })

    try {
      growth.grow("reply", 0, 450, false, undefined, true)
      const advance = schedule.mock.calls[0]![1]
      Array.from({ length: 10 }, () => advance(1 / 60))
      growth.grow("reply", sizes.at(-1)!, 480, false, undefined, false)
      Array.from({ length: 5 }, () => advance(1 / 60))
      const steps = sizes.slice(10).map((size, index) => size - sizes[index + 9]!)
      expect(steps.every((step) => step > 0)).toBe(true)
      expect(Math.max(...steps)).toBeLessThanOrEqual(16)
    } finally {
      growth.finish()
      schedule.mockRestore()
    }
  })

  test.each([false, true])("closes a neighbour independently of arrivals (close first: %s)", (closeFirst) => {
    const schedule = spyOn(frameLoop, "addMeasured").mockImplementation(() => () => {})
    const trace = (arrival: number) => {
      const closing: number[] = []
      const arriving: number[] = []
      const growth = createRowGrowth({
        measure: () => {},
        resize: (key, size) => {
          if (key === "closing") closing.push(size)
          if (key === "arriving") arriving.push(size)
        },
        below: () => true,
        settle: () => {},
      })
      try {
        if (closeFirst) growth.grow("closing", 100, 24)
        if (arrival) growth.grow("arriving", 0, arrival)
        if (!closeFirst) growth.grow("closing", 100, 24)
        const advance = schedule.mock.calls.at(-1)![1]
        Array.from({ length: 180 }, () => advance(1 / 60))
        expect(growth.growing()).toBe(false)
        return { closing, arriving }
      } finally {
        growth.finish()
      }
    }
    try {
      const alone = trace(0)
      const together = trace(450)
      expect(together.arriving[0]).toBeGreaterThan(0)
      expect(together.arriving[0]).toBeLessThan(450)
      expect(together.closing[0]).toBeLessThan(100)
      expect(together.closing[0]).toBeGreaterThan(24)
      expect(together.closing.at(-1)).toBe(24)
      expect(together.closing).toEqual(alone.closing)
    } finally {
      schedule.mockRestore()
    }
  })

  test("eases a row on the layout grid, behind a soft edge that clears when it lands", async () => {
    const { growth, sizes, wrapper, frames } = setup()
    growth.grow("row", 0, 120.5)
    expect(growth.target("row")).toBe(120.5)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(wrapper.style.getPropertyValue("mask-image")).toContain("linear-gradient")

    await settle(growth, frames)
    expect(growth.target("row")).toBeUndefined()
    expect(sizes.at(-1)).toBe(120.5)
    expect(sizes.every((size, index) => Number.isInteger(size * 64) && size >= (sizes[index - 1] ?? 0))).toBe(true)
    expect(sizes.slice(0, -1).some((size) => !Number.isInteger(size))).toBe(true)
    expect(wrapper.style.getPropertyValue("mask-image")).toBe("")
  })

  test("bends a running growth toward a new height instead of restarting it", async () => {
    const { growth, sizes, frames } = setup()
    growth.grow("row", 0, 100)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const reached = sizes.at(-1) ?? 0
    growth.grow("row", 0, 200)

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(sizes.at(-1)).toBeGreaterThanOrEqual(reached)

    await settle(growth, frames)
    expect(sizes.at(-1)).toBe(200)
  })

  test("lands on a nearer target instead of passing it and coming back", async () => {
    const { growth, sizes, frames } = setup()
    growth.grow("row", 0, 200)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const near = (sizes.at(-1) ?? 0) + 2
    growth.grow("row", 0, near)

    await settle(growth, frames)
    expect(sizes.at(-1)).toBe(near)
    expect(sizes.every((size) => size <= near)).toBe(true)
  })

  test("reports once per frame how far the rows still have to grow", async () => {
    const { growth, frames } = setup()
    growth.grow("row", 0, 80)

    await settle(growth, frames)
    expect(frames[0]!.pending).toBeGreaterThan(0)
    expect(frames.at(-1)).toEqual({ pending: 0, held: 0 })
    expect(frames.every((frame, index) => frame.pending <= (frames[index - 1]?.pending ?? Infinity))).toBe(true)
  })

  test("closes a held gap on the same spring", async () => {
    const { growth, frames } = setup()
    growth.hold(40)

    await settle(growth, frames)
    expect(frames[0]!.held).toBeGreaterThan(0)
    expect(frames[0]!.held).toBeLessThanOrEqual(40)
    expect(frames.at(-1)!.held).toBe(0)
    expect(frames.every((frame, index) => frame.held <= (frames[index - 1]?.held ?? 40))).toBe(true)
  })

  test("fills a held gap with growth below it before closing the rest", async () => {
    const { growth, sizes, frames } = setup()
    growth.hold(40)
    growth.grow("row", 0, 30)

    await settle(growth, frames)
    expect(sizes.at(-1)).toBe(30)
    expect(sizes.slice(0, -1).every((size, index) => frames[index]!.held === 40 - size)).toBe(true)
    expect(frames.at(-1)!.held).toBe(0)
  })

  test("lands rows at once", () => {
    const { growth, sizes, wrapper } = setup()
    growth.grow("row", 10, 300)
    growth.land("row", 280)
    expect(sizes.at(-1)).toBe(280)
    expect(growth.target("row")).toBeUndefined()

    growth.grow("row", 0, 90)
    growth.finish()
    expect(sizes.at(-1)).toBe(90)
    expect(growth.target("row")).toBeUndefined()
    expect(wrapper.style.getPropertyValue("mask-image")).toBe("")
  })

  test("absorbs a removed neighbour's height and closes the gap on the shared spring", async () => {
    const { growth, sizes, frames } = setup()
    growth.absorb("row", 120, 28, 28)
    expect(growth.target("row")).toBe(28)

    await settle(growth, frames)
    expect(growth.target("row")).toBeUndefined()
    expect(sizes[0]).toBeLessThan(148)
    expect(sizes[0]).toBeGreaterThan(28)
    expect(sizes.at(-1)).toBe(28)
    expect(sizes.every((size, index) => size <= (sizes[index - 1] ?? 148))).toBe(true)
  })

  test("offers streaming edges from Feather, as shipped, to unmasked lines", () => {
    const [feather, fast, whole, fade] = (["feather", "fast", "whole", "fade"] as const).map(streamingEdgeFor)
    expect(feather).toEqual({ catchUp: 1, feather: 28, floor: 18, fadeOut: 1.8, spring: 1, clip: true })
    expect(fast!.catchUp > feather!.catchUp && fast!.feather < feather!.feather && fast!.clip).toBe(true)
    expect([whole!.clip, whole!.feather, fade!.clip, fade!.feather]).toEqual([false, 0, false, 0])
  })

  test("computes WorkingHandoffPose curves for copy handoff and reduced motion", () => {
    expect(workingHandoffPose(0)).toEqual({
      indicatorOpacity: 1,
      indicatorBlur: 0,
      indicatorScale: 1,
      copyOpacity: 0,
      copyBlur: 6,
      copyScale: 0.6,
    })
    const mid = workingHandoffPose(0.5, true, false)
    expect(mid.indicatorOpacity).toBeLessThan(0.5)
    expect(mid.indicatorBlur).toBeGreaterThan(3)
    expect(mid.indicatorScale).toBeLessThan(0.75)
    expect(mid.copyOpacity).toBeGreaterThan(0.5)
    expect(mid.copyBlur).toBeLessThan(4.5)
    expect(mid.copyScale).toBeGreaterThan(0.8)
    expect(workingHandoffPose(1, true, false)).toEqual({
      indicatorOpacity: 0,
      indicatorBlur: 6,
      indicatorScale: 0.5,
      copyOpacity: 1,
      copyBlur: 0,
      copyScale: 1,
    })
    expect(workingHandoffPose(0.5, true, true)).toEqual({
      indicatorOpacity: 0.5,
      indicatorBlur: 0,
      indicatorScale: 1,
      copyOpacity: 0.5,
      copyBlur: 0,
      copyScale: 1,
    })
  })

  test("maintains a continuous feather cushion across streaming target advances", async () => {
    const { growth, sizes, wrapper, frames } = setup()
    growth.grow("row", 46, 50, false, undefined, true)
    await Bun.sleep(25)
    const mask = wrapper.style.getPropertyValue("mask-image")
    const px = Number(mask.match(/calc\(100% - (\d+)px\)/)?.[1] ?? 0)
    expect(px).toBeGreaterThanOrEqual(16)
    growth.grow("row", 46, 90, false, undefined, true)
    await settle(growth, frames)
    expect(sizes.at(-1)).toBe(90)
    expect(wrapper.style.getPropertyValue("mask-image")).toBe("")
  })

  test("glides Working smoothly across single and multi-steer promotions without jumping or clipping", async () => {
    const actWrapper = document.createElement("div")
    const actInner = document.createElement("div")
    actWrapper.appendChild(actInner)
    const gap1Wrapper = document.createElement("div")
    const gap2Wrapper = document.createElement("div")
    const latest = new Map<string, number>([
      ["gap-1", 60],
      ["gap-2", 24],
      ["activity", 0],
    ])
    const trace: { act: number; gap1: number; gap2: number; tx: number; wkY: number }[] = []
    const frames: { pending: number; held: number }[] = []

    const growth = createRowGrowth({
      measure: () => {},
      resize: (key, size) => {
        latest.set(key, size)
        if (key === "activity") return actWrapper
        if (key === "gap-1") return gap1Wrapper
        if (key === "gap-2") return gap2Wrapper
        return false
      },
      below: () => true,
      movesWorking: (key) => key === "activity",
      settle: (state) => {
        frames.push(state)
        const act = latest.get("activity") ?? 0
        const gap1 = latest.get("gap-1") ?? 24
        const gap2 = latest.get("gap-2") ?? 24
        const tf = actInner.style.transform
        const m = tf.match(/translateY\((-?\d+(?:\.\d+)?)px\)/)
        const tx = m ? Number(m[1]) : 0
        const wrapperTop = gap1 + 73 + gap2 + 73
        trace.push({ act, gap1, gap2, tx, wkY: wrapperTop + tx })
      },
    })

    // Promote steer 1 & 2 together: total height between origin (0) and activity wrapper is (60 + 73 + 24 + 73) = 230
    actInner.style.transform = "translateY(-230px)"
    growth.grow("activity", 0, 36, false, {
      gaps: [{ key: "gap-1", base: 24, extra: 36 }],
      moveDistance: 230,
    })

    const deadline = performance.now() + 4000
    while (growth.target("activity") !== undefined && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16))
    }

    expect(growth.target("activity")).toBeUndefined()
    expect(latest.get("activity")).toBe(36)
    expect(latest.get("gap-1")).toBe(24)
    expect(actInner.style.transform).toBe("")
    expect(actWrapper.style.getPropertyValue("mask-image")).toBe("")
    expect(frames.every((f) => f.pending === 0)).toBe(true)
    expect(trace.every((t) => Math.abs(t.act + t.gap1 - 60) < 0.05)).toBe(true)

    let prevY = 0
    const dys = trace.map((t) => {
      const dy = t.wkY - prevY
      prevY = t.wkY
      return dy
    })
    expect(dys[0]).toBeGreaterThan(0)
    expect(dys[0]).toBeLessThanOrEqual(2.1)
    expect(dys.every((dy) => dy >= -0.05 && dy <= 8)).toBe(true)
    expect(trace.at(-1)?.wkY).toBe(194)
  })

  test("a row that joins a glide midway shrinks on it from where it stands and lands with Working", async () => {
    const sizes: Record<string, number[]> = { gap: [], row: [] }
    const actWrapper = document.createElement("div")
    actWrapper.appendChild(document.createElement("div"))
    const growth = createRowGrowth({
      measure: () => {},
      resize: (key, size) => {
        if (key === "activity") return actWrapper
        sizes[key]?.push(size)
        return document.createElement("div")
      },
      below: () => true,
      settle: () => {},
    })
    growth.grow("activity", 0, 36, false, { gaps: [{ key: "gap", base: 24, extra: 36 }], moveDistance: 160 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const shown = growth.shown("activity")!
    const ratio = 1 - shown / 36
    expect(ratio).toBeGreaterThan(0.25)
    growth.grow("activity", shown, 36, false, {
      gaps: [...growth.coupled("activity")!.gaps, { key: "row", base: 37, extra: (61 - 37) / ratio }],
      moveDistance: 160,
    })
    const deadline = performance.now() + 3000
    while (growth.target("activity") !== undefined && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 16))
    const row = sizes.row!
    expect(Math.abs(row[0]! - 61)).toBeLessThanOrEqual(2)
    expect(row.at(-1)).toBe(37)
    expect(sizes.gap!.at(-1)).toBe(24)
    expect(row.every((size, index) => index === 0 || (size <= row[index - 1]! && row[index - 1]! - size <= 8))).toBe(
      true,
    )
  })

  test("closes a coupled gap on the spring when Working leaves mid-glide", async () => {
    const gaps: number[] = []
    const actWrapper = document.createElement("div")
    actWrapper.appendChild(document.createElement("div"))
    const frames: { pending: number; held: number }[] = []
    let activity = true
    const growth = createRowGrowth({
      measure: () => {},
      resize: (key, size) => {
        if (key === "gap") {
          gaps.push(size)
          return document.createElement("div")
        }
        return key === "activity" && activity ? actWrapper : false
      },
      below: () => true,
      settle: (state) => frames.push(state),
    })
    growth.grow("activity", 0, 36, false, { gaps: [{ key: "gap", base: 24, extra: 36 }], moveDistance: 120 })
    await new Promise((resolve) => setTimeout(resolve, 70))
    const before = gaps.at(-1)!
    expect(before).toBeGreaterThan(24)
    activity = false
    growth.release("activity")
    expect(gaps.at(-1)).toBe(before)
    const deadline = performance.now() + 3000
    while (growth.target("gap") !== undefined && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 16))
    expect(gaps.at(-1)).toBe(24)
    const after = gaps.slice(gaps.indexOf(before))
    expect(
      after.every((size, index) => index === 0 || (size <= after[index - 1]! && after[index - 1]! - size <= 8)),
    ).toBe(true)
  })
})
