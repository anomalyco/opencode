import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAnimatable, spring, tween } from "../../src/ui/animation"

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for animation state")
}

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
    await waitFor(() => visual.value().selection === 1)
    expect(visual.value()).toEqual({ widths: [12, 4], selection: 1 })
  } finally {
    dispose()
  }
})

test("retains spring state while retargeting and supports immediate jumps", async () => {
  let dispose = () => {}
  const visual = createRoot((nextDispose) => {
    dispose = nextDispose
    return createAnimatable({ value: 0 }, { transition: spring({ visualDuration: 0.2 }) })
  })

  try {
    visual.animate({ value: 1 })
    await waitFor(() => visual.value().value > 0 && visual.value().value < 1)
    const target = visual.value().value
    visual.animate({ value: target })
    await waitFor(() => visual.value().value !== target)
    await waitFor(() => visual.value().value === target)
    expect(visual.value().value).toBeCloseTo(target)
    visual.jump({ value: 0 })
    expect(visual.value().value).toBe(0)
  } finally {
    dispose()
  }
})
