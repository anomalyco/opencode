import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const paths = {
  Escape: (page) => page.keyboard.press("Escape"),
  "a backdrop click": (page) => page.mouse.click(8, 8),
  "the close button": (page) => page.getByRole("button", { name: "Close" }).click(),
} satisfies Record<string, (page: Page) => Promise<void>>

for (const [path, close] of Object.entries(paths)) {
  story(`takes the page's clicks as soon as the image preview closes with ${path}`, async ({ mount, page }) => {
    await mount("components-image-preview--from-message")
    await open(page)
    await page.locator('[data-component="image-preview"][data-stage="rest"]').waitFor()
    await close(page)
    await expect(clickPage(page)).resolves.toBe(true)
  })
}

story("takes the page's clicks as soon as the image preview closes mid-flight", async ({ mount, page }) => {
  await mount("components-image-preview--from-message")
  await open(page)
  await page.locator('[data-component="image-preview"][data-stage="flying"]').waitFor()
  await page.keyboard.press("Escape")
  await expect(clickPage(page)).resolves.toBe(true)
})

story("a close mid-flight after the origin is gone fades out without landing at rest", async ({ mount, page }) => {
  await mount("components-image-preview--from-message")
  await open(page)
  const preview = page.locator('[data-component="image-preview"]')
  await preview.waitFor({ state: "attached" })

  // In the page, so the close lands mid-flight however slow the runner: the origin goes the moment the flight starts,
  // and Escape follows. Every stage the preview shows from then on is recorded.
  const stages = await preview.evaluateHandle((element: HTMLElement) => {
    const seen: (string | undefined)[] = []
    let closed = false

    const close = () => {
      if (closed || element.dataset.stage === "pending") return
      closed = true
      document.querySelector('[data-story-image="inline"]')?.remove()
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    }

    new MutationObserver(() => {
      if (closed) seen.push(element.dataset.stage)
      close()
    }).observe(element, { attributes: true, attributeFilter: ["data-stage"] })
    close()

    return seen
  })

  await expect(preview).toHaveCount(0)
  const seen = await stages.jsonValue()
  expect(seen).toContain("closing")
  expect(seen).not.toContain("rest")
})

story("a pan whose release never reaches the preview stops following the pointer", async ({ mount, page }) => {
  await mount("components-image-preview--from-message")
  await open(page)
  const body = page.locator('[data-slot="image-preview-body"]')
  const image = page.locator('[data-slot="image-preview-image"]')
  await expect(page.locator('[data-component="image-preview"]')).toHaveAttribute("data-stage", "rest")
  await image.dblclick()
  await expect(body).toHaveAttribute("data-zoomed", "")

  const box = await body.boundingBox()

  if (!box) throw new Error("the preview body is not laid out")
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  const pointer = await body.evaluateHandle((element: HTMLElement) => {
    const seen = { id: -1 }
    element.addEventListener("pointerdown", (event) => (seen.id = event.pointerId), { once: true })

    return seen
  })

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 30, y + 10)
  await expect(body).toHaveAttribute("data-dragging", "")

  // The pointer loses capture, as when the window loses focus mid-drag, and the button comes up outside the body.
  await body.evaluate((element, seen) => element.releasePointerCapture(seen.id), pointer)
  await page.mouse.move(x, box.y / 2)
  await page.mouse.up()
  const transform = await image.evaluate((element) => element.style.transform)

  await page.mouse.move(x, y)
  await page.mouse.move(x - 60, y - 30)
  await expect(body).not.toHaveAttribute("data-dragging")
  expect(await image.evaluate((element) => element.style.transform)).toBe(transform)
})

async function open(page: Page) {
  await page.locator('[data-story-image="inline"]').click()
}

// A raw click, without Playwright waiting for the point to be clear, as a hand would make it while the image flies home.
async function clickPage(page: Page) {
  const text = page.getByText("Here is the poster")
  const box = await text.boundingBox()

  if (!box) throw new Error("the page text is not laid out")
  await text.evaluate((element) => {
    element.addEventListener("click", () => element.setAttribute("data-clicked", ""), { once: true })
  })
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  return text.evaluate((element) => element.hasAttribute("data-clicked"))
}

story("the first Escape zooms the image preview back to fit and the next closes it", async ({ mount, page }) => {
  await mount("components-image-preview--from-message")
  await open(page)
  const preview = page.locator('[data-component="image-preview"]')
  const level = page.locator('[data-slot="image-preview-zoom-level"]')
  await expect(preview).toHaveAttribute("data-stage", "rest")
  const fit = (await level.textContent()) ?? ""

  await page.locator('[data-slot="image-preview-image"]').dblclick()
  await expect(level).not.toHaveText(fit)
  await page.keyboard.press("Escape")
  await expect(level).toHaveText(fit)
  await expect(preview).toHaveAttribute("data-stage", "rest")
  await page.keyboard.press("Escape")
  await expect(preview).toHaveCount(0)
})

story(
  "a video whose pane closes under the preview is let go on close instead of moved back",
  async ({ mount, page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mount("components-image-preview--from-video")
    const video = page.locator("[data-story-video]")
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0)
    await video.dblclick()
    const preview = page.locator('[data-component="image-preview"]')
    await expect(preview).toHaveAttribute("data-stage", "rest")
    await expect(preview.locator("video")).toHaveCount(1)

    // The pane goes the way a closed tab does, while the preview still shows its video.
    await page.locator("[data-story-pane]").evaluate((element) => element.remove())
    await expect(preview.locator("video")).toHaveCount(1)
    await page.keyboard.press("Escape")
    await expect(preview).toHaveCount(0)
    await expect(page.locator("video")).toHaveCount(0)
    expect(errors).toEqual([])
  },
)
