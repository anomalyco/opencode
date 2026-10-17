import { expect, test, type Page } from "@playwright/test"
import { historyMessages, setupTimeline } from "../utils/timeline"

// Scrolling up from the end without a wheel event must stop the timeline following the end.
// The custom thumb swallows its own pointer-down, and autoscroll produces no pointer or wheel
// event at all, so any rule that names input devices leaves those gestures pinned and every
// size update pulls the viewport back down (#56285).

test.use({ viewport: { width: 1200, height: 800 } })

test("dragging the scrollbar thumb up from the end travels up and stays there", async ({ page }) => {
  await openLongSession(page)
  const scroller = timelineScroller(page)
  await scroller.hover()
  const thumb = page.locator('.scroll-view__thumb[data-orientation="vertical"]').first()
  await expect(thumb).toHaveAttribute("data-visible", "true")
  const view = (await scroller.boundingBox())!
  const grip = (await thumb.boundingBox())!

  await startSampling(page, 4000)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()

  // Drag the thumb to the top over ~1s and hold it there, so the samples cover the whole gesture.
  for (let step = 1; step <= 30; step++) {
    await page.mouse.move(
      grip.x + grip.width / 2,
      grip.y + grip.height / 2 - ((grip.y - view.y) * step) / 30,
    )
    await page.waitForTimeout(30)
  }

  await page.waitForTimeout(800)
  const held = await samples(page)
  await page.mouse.up()

  expect(held.peak).toBeGreaterThan(200)
  expect(held.final).toBeGreaterThan(200)
  // A single frame carrying the viewport back toward the end is the gesture being undone.
  expect(held.snaps).toBe(0)
})

test("autoscroll-style scrolling up from the end is not pulled back", async ({ page }) => {
  await openLongSession(page)
  const scroller = timelineScroller(page)

  await startSampling(page, 4000)
  // Autoscroll and some assistive scrolling move the offset with no wheel, key or pointer event.
  await scroller.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let remaining = 600

        const step = () => {
          if (remaining <= 0) return resolve()
          element.scrollTop -= 40
          remaining -= 40
          requestAnimationFrame(step)
        }

        requestAnimationFrame(step)
      }),
  )
  await page.waitForTimeout(800)
  const swept = await samples(page)

  expect(swept.peak).toBeGreaterThan(200)
  expect(swept.final).toBeGreaterThan(200)
  expect(swept.snaps).toBe(0)
})

async function openLongSession(page: Page) {
  await setupTimeline(page, { messages: historyMessages(80), reducedMotion: true })
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  await expect
    .poll(() => timelineScroller(page).evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(1200)
  // The session opens at the end, which is where every gesture below starts.
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(2)
}

function timelineScroller(page: Page) {
  return page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
}

function distanceFromEnd(page: Page) {
  return timelineScroller(page).evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
  )
}

async function startSampling(page: Page, duration: number) {
  await timelineScroller(page).evaluate((element, duration) => {
    const samples: { fromEnd: number }[] = []
    const start = performance.now()
    window.__scrollUnpinSamples = samples

    const tick = () => {
      samples.push({ fromEnd: Math.round(element.scrollHeight - element.clientHeight - element.scrollTop) })

      if (performance.now() - start < duration) requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  }, duration)
}

async function samples(page: Page) {
  const collected = (await page.evaluate(() => window.__scrollUnpinSamples ?? [])).map((sample) => sample.fromEnd)

  // `snaps` counts frames that carried the viewport back toward the end; growing `peak` is the
  // furthest the gesture reached from the end.
  return {
    peak: Math.max(...collected),
    final: collected.at(-1) ?? 0,
    snaps: collected.filter((fromEnd, index) => index > 0 && fromEnd < collected[index - 1]! - 50).length,
  }
}

declare global {
  interface Window {
    __scrollUnpinSamples?: { fromEnd: number }[]
  }
}
