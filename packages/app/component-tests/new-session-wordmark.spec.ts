import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

// A cell of the "c" in the wordmark (column 40, row 2 of the 78×14 pin grid).
const PIN = { x: 40.5 / 78, y: 2.5 / 14 }

// An empty cell above the "o", clear of every pin, side and shadow at rest.
const EMPTY = { x: 5.5 / 78, y: 0.5 / 14 }

story("draws the wordmark as pins and stops animating once settled", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await mount("app-new-session-wordmark--pin-board")

  const empty = await pinPixel(page, EMPTY)
  await expect.poll(() => pinPixel(page)).not.toEqual(empty)
  await expect.poll(() => requestedFrames(page)).toBe(0)
})

story("knocks pins out from the panel but never from the composer", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await mount("app-new-session-wordmark--pin-board")
  await expect.poll(() => requestedFrames(page)).toBe(0)
  const before = await pinPixel(page)

  await page.locator('[data-component="composer"]').click()
  await nextFrames(page, 2)
  expect(await pinPixel(page)).toEqual(before)

  const box = (await page.locator('[data-slot="wordmark-box"]').boundingBox())!
  await page.mouse.click(box.x + box.width * PIN.x, box.y + box.height * PIN.y)
  await expect.poll(() => pinPixel(page)).not.toEqual(before)
})

story("shows a static pin board with reduced motion", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await mount("app-new-session-wordmark--pin-board")
  const empty = await pinPixel(page, EMPTY)
  await expect.poll(() => pinPixel(page)).not.toEqual(empty)
  await expect.poll(() => requestedFrames(page)).toBe(0)
  const before = await pinPixel(page)

  const box = (await page.locator('[data-slot="wordmark-box"]').boundingBox())!
  await page.mouse.click(box.x + box.width * PIN.x, box.y + box.height * PIN.y)
  await nextFrames(page, 2)
  expect(await pinPixel(page)).toEqual(before)
  expect(await requestedFrames(page)).toBe(0)
})

// Reads the on-screen pixel at a grid cell. The board may be drawn with WebGL, whose canvas cannot be read
// back once presented, so the pixel comes from a screenshot decoded in the page.
async function pinPixel(page: Page, cell = PIN) {
  const box = (await page.locator('[data-slot="wordmark-box"]').boundingBox())!

  const shot = await page.screenshot({
    clip: { x: box.x + box.width * cell.x, y: box.y + box.height * cell.y, width: 1, height: 1 },
  })

  return page.evaluate(async (png) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext("2d")!
    context.drawImage(image, 0, 0)
    const d = context.getImageData(0, 0, 1, 1).data

    return { red: d[0], green: d[1], blue: d[2] }
  }, shot.toString("base64"))
}

// Counts animation frames the page requests while we watch the next 20 frames.
function requestedFrames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const original = window.requestAnimationFrame
        const watch = original.bind(window)
        const state = { requested: 0, left: 20 }
        window.requestAnimationFrame = (callback) => {
          state.requested++

          return watch(callback)
        }

        const tick = () => {
          if (--state.left > 0) return watch(tick)
          window.requestAnimationFrame = original
          resolve(state.requested)
        }

        watch(tick)
      }),
  )
}

function nextFrames(page: Page, count: number) {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const tick = (left: number) => (left ? requestAnimationFrame(() => tick(left - 1)) : resolve())
        tick(count)
      }),
    count,
  )
}
