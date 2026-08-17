import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAnimatable, spring, tween } from "../../src/ui/animation"

test("animates numeric objects and arrays to their targets", async () => {
  let dispose = () => {}
  const visual = createRoot((nextDispose) => {
    dispose = nextDispose
    return createAnimatable(
      { widths: [8, 8], selection: 0 },
      { transition: tween({ duration: 0.02, ease: (progress) => progress }) },
    )
  })

  try {
    visual.animate({ widths: [12, 4], selection: 1 })
    await Bun.sleep(80)
    expect(visual.value()).toEqual({ widths: [12, 4], selection: 1 })
  } finally {
    dispose()
  }
})

test("retains spring state while retargeting and supports immediate jumps", async () => {
  let dispose = () => {}
  const visual = createRoot((nextDispose) => {
    dispose = nextDispose
    return createAnimatable({ value: 0 }, { transition: spring({ visualDuration: 0.02 }) })
  })

  try {
    visual.animate({ value: 1 })
    await Bun.sleep(20)
    const target = visual.value().value
    visual.animate({ value: target })
    await Bun.sleep(20)
    expect(visual.value().value).not.toBe(target)
    await Bun.sleep(80)
    expect(visual.value().value).toBeCloseTo(target)
    visual.jump({ value: 0 })
    expect(visual.value().value).toBe(0)
  } finally {
    dispose()
  }
})
