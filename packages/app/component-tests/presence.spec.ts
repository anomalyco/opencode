import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./presence.fixture.tsx", import.meta.url))

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app's styles; the fixture mounts the presences beside it.
  await mount("ui-line-comment--editor")
  await page.evaluate(async (fixture) => {
    const { mountPresence } = await import(fixture)
    mountPresence()
  }, fixture)
})

story("hides an exit whose element was unmounted mid-animation", async ({ page }) => {
  const root = page.getByTestId("presence-fixture")
  await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ hint: "Move to background" })
  }, fixture)
  await expect(root.getByTestId("hint-bottom")).toHaveText("Move to background")

  // The hint starts its exit, then its lane goes away before the animation ends, as when the timeline stops being live.
  const hiding = await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ hint: undefined })
    const state = document.querySelector('[data-testid="presence-state"]')?.textContent
    setPresence({ lane: "none" })

    return state
  }, fixture)

  expect(hiding).toBe("hiding")
  await expect(root.getByTestId("presence-state")).toHaveText("hidden")
})

story("hides at once when its element is swapped mid-exit", async ({ page }) => {
  const root = page.getByTestId("presence-fixture")
  await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ hint: "Move to background" })
  }, fixture)
  await expect(root.getByTestId("hint-bottom")).toBeVisible()

  // Moving to the other lane mounts a second element mid-exit; it must not replay the fade from full opacity.
  const states = await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    const read = () => document.querySelector('[data-testid="presence-state"]')?.textContent
    setPresence({ hint: undefined })
    const hiding = read()
    setPresence({ lane: "row" })

    return [hiding, read()]
  }, fixture)

  expect(states).toEqual(["hiding", "hidden"])
  await expect(root.getByTestId("hint-row")).toHaveCount(0)
})

story("hides when Reduce Motion turns on mid-exit", async ({ page }) => {
  const root = page.getByTestId("presence-fixture")
  await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ hint: "Move to background" })
  }, fixture)
  await expect(root.getByTestId("hint-bottom")).toBeVisible()

  const states = await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    const read = () => document.querySelector('[data-testid="presence-state"]')?.textContent
    setPresence({ hint: undefined })
    const hiding = read()
    // What the app does when the setting or the system preference changes. `motion-reduce:animate-none` drops the
    // exit animation, and Chromium fires no `animationcancel` for it.
    document.documentElement.dataset.motion = "reduce"
    await Promise.resolve()

    return [hiding, read()]
  }, fixture)

  expect(states).toEqual(["hiding", "hidden"])
  await expect(root.getByTestId("hint-bottom")).toHaveCount(0)
})

story("keeps the dropzone mounted while its fade-out transition plays", async ({ page }) => {
  const dropzone = page.locator('[data-component="session-dropzone"]')
  await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ active: true })
  }, fixture)
  await expect(dropzone).toHaveAttribute("data-visible", "true")

  const leaving = await page.evaluate(async (fixture) => {
    const { setPresence } = await import(fixture)
    setPresence({ active: false })
    const element = document.querySelector('[data-component="session-dropzone"]')

    return element?.getAttribute("data-visible")
  }, fixture)

  expect(leaving).toBe("false")
  await expect(dropzone).toHaveCount(0)
})
