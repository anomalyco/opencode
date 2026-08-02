import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectSessionTitle } from "../utils/waits"

test.describe("smoke: scroll view thumb hover expansion", () => {
  test("expands on hover, holds while dragging off the strip, and collapses after the pointer leaves", async ({
    page,
  }) => {
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await seedProject(page, fixture.directory)
    await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.targetID}`)
    await expectSessionTitle(page, fixture.expected.targetTitle)

    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await expect(scroller).toBeVisible({ timeout: APP_READY_TIMEOUT })
    const thumb = page
      .locator(".scroll-view")
      .filter({ has: page.locator("[data-timeline-row]") })
      .locator(".scroll-view__thumb")
    await expect(thumb).toBeAttached()

    const geometry = () => thumbGeometry(thumb)
    await expect.poll(geometry).toEqual({ strip: 12, bar: 4 })
    const viewportWidth = await scroller.evaluate((element) => element.clientWidth)

    // Hovering the thumb strip expands it as an overlay.
    await hoverThumb(page, thumb)
    await expect.poll(geometry).toEqual({ strip: 16, bar: 8 })
    expect(await scroller.evaluate((element) => element.clientWidth)).toBe(viewportWidth)

    // Leaving the strip collapses it again.
    await pointAway(page, scroller)
    await expect.poll(geometry).toEqual({ strip: 12, bar: 4 })

    // The expanded state stays stable for the entire drag, even when the
    // pointer moves off the strip, and collapses once released outside it.
    await hoverThumb(page, thumb)
    await expect.poll(geometry).toEqual({ strip: 16, bar: 8 })
    const box = await thumb.boundingBox()
    if (!box) throw new Error("Scroll thumb is not visible")
    await page.mouse.down()
    await expect(thumb).toHaveAttribute("data-dragging", "true")
    await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 5 })
    await expect.poll(geometry).toEqual({ strip: 16, bar: 8 })
    await page.mouse.up()
    await expect.poll(geometry).toEqual({ strip: 12, bar: 4 })
  })
})

async function seedProject(page: Page, directory: string) {
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: {
          local: [{ worktree: directory, expanded: true }],
        },
        lastProject: {
          local: directory,
        },
      }),
    )
  }, directory)
}

async function thumbGeometry(thumb: Locator) {
  return thumb.evaluate((element) => ({
    strip: parseFloat(getComputedStyle(element).width),
    bar: parseFloat(getComputedStyle(element, "::after").width),
  }))
}

async function hoverThumb(page: Page, thumb: Locator) {
  const box = await thumb.boundingBox()
  if (!box) throw new Error("Scroll thumb is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function pointAway(page: Page, scroller: Locator) {
  const box = await scroller.boundingBox()
  if (!box) throw new Error("Timeline scroller is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}
