import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./grow.fixture.tsx", import.meta.url))

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app's styles; the fixture mounts a `Grow` beside it.
  await mount("ui-line-comment--editor")
  await page.evaluate(async (fixture) => {
    const { mountGrow } = await import(fixture)
    mountGrow()
  }, fixture)
})

// What a grow leaves on its wrapper while it moves, and clears when it lands.
const motion = (page: Page) =>
  page
    .getByTestId("grow-child")
    .locator("..")
    .evaluate((el) => ({ moving: el.hasAttribute("data-moving"), height: el.style.height, opacity: el.style.opacity }))

const still = { moving: false, height: "", opacity: "" }

story("keeps its children mounted when it reopens and turns instant in one batch mid-close", async ({ page }) => {
  const root = page.getByTestId("grow-fixture")
  await page.evaluate(async (fixture) => {
    const { setGrow } = await import(fixture)
    setGrow({ when: true })
  }, fixture)
  await expect(root.getByTestId("grow-child")).toBeVisible()
  await expect.poll(() => motion(page)).toEqual(still)

  const closing = await page.evaluate(async (fixture) => {
    const { setGrow } = await import(fixture)
    setGrow({ when: false })

    for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
    const moving = !!document.querySelector('[data-testid="grow-fixture"] [data-moving]')
    // `instant` is written first, so anything reacting to it alone runs before `when` reopens.
    setGrow({ instant: true, when: true })

    return moving
  }, fixture)

  expect(closing).toBe(true)
  await expect(root.getByTestId("grow-closed")).toHaveText("0")
  await expect(root.getByTestId("grow-mounts")).toHaveText("1")
  expect(await motion(page)).toEqual(still)
})

story("finishes opening and closing while detached like a cached session tab", async ({ page }) => {
  const root = page.getByTestId("grow-fixture")

  const toggleDetached = (when: boolean) =>
    page.evaluate(
      async ({ fixture, when }) => {
        const { attach, detach, setGrow } = await import(fixture)
        detach()
        setGrow({ when })

        for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
        attach()
      },
      { fixture, when },
    )

  await toggleDetached(true)
  await expect(root.getByTestId("grow-child")).toBeVisible()
  expect(await motion(page)).toEqual(still)

  await toggleDetached(false)
  await expect(root.getByTestId("grow-closed")).toHaveText("1")
  await expect(root.getByTestId("grow-child")).toHaveCount(0)
})
