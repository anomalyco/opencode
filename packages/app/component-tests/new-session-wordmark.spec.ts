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

story("the lodger pops the pin board out and packs it back into the e", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await mount("app-new-session-wordmark--flat")
  const grip = page.locator('[data-slot="wordmark-lodger-grip"]')
  const flat = page.locator('[data-slot="wordmark-flat"]')
  const board = page.locator("canvas")
  await expect(board).toHaveCount(0)

  // Pulling the lodger well past its slip distance pops every pin out into the board.
  const hole = (await grip.boundingBox())!
  await page.mouse.move(hole.x + hole.width / 2, hole.y + hole.height / 2)
  await page.mouse.down()
  await page.mouse.move(hole.x + hole.width / 2 + 160, hole.y + hole.height / 2 + 80, { steps: 12 })
  await page.mouse.up()
  await expect(flat).toBeHidden()
  await expect(board).not.toHaveCount(0)
  await expect.poll(() => requestedFrames(page)).toBe(0)

  // Carrying it from its perch back into the "e" reels the pins in and tucks the lodger away.
  const lodger = (await page.locator('[data-slot="wordmark-lodger"]').boundingBox())!
  const unit = lodger.width / 234
  const perch = (await grip.boundingBox())!
  await page.mouse.move(perch.x + perch.width / 2, perch.y + perch.height / 2)
  await page.mouse.down()
  await page.mouse.move(perch.x + perch.width / 2 - 24 * unit, perch.y + perch.height / 2 - 16 * unit, { steps: 12 })
  await page.mouse.up()
  await expect(board).toHaveCount(0)
  await expect(flat).toBeVisible()
  await expect.poll(() => requestedFrames(page)).toBe(0)
  await expect(grip).toBeVisible()
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
