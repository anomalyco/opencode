import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./text-lifecycle.fixture.tsx", import.meta.url))

story("the typewriter shows no cursor without text and clears when its text is cleared", async ({ mount, page }) => {
  await mount("ui-text-shimmer--inactive")

  const controls = await page.evaluateHandle(async (fixture) => {
    const { mountTextLifecycle } = await import(fixture)

    return mountTextLifecycle()
  }, fixture)

  const typewriter = page.getByTestId("text-lifecycle-fixture").locator("p")

  // Before the machine, an empty typewriter showed a blinking cursor forever.
  await expect(typewriter).toHaveText("")

  await controls.evaluate((text) => text.setText("Hello world"))
  await expect(typewriter).toHaveText(/^Hel.*│$/)
  await controls.evaluate((text) => text.setText(""))

  // Before the machine, the partial text and a solid cursor stayed on screen forever.
  await expect(typewriter).toHaveText("")
})

story("a shimmer stops its sweep at once under reduced motion", async ({ mount, page }) => {
  await mount("ui-text-shimmer--inactive")

  const runs = await page.evaluate(async (fixture) => {
    const { mountTextLifecycle } = await import(fixture)
    const shimmer = mountTextLifecycle()
    const active = shimmer.run()
    document.documentElement.setAttribute("data-motion", "reduce")
    shimmer.setActive(false)

    return [active, shimmer.run()]
  }, fixture)

  // Before the machine, the sweep kept running for the 220 ms crossfade that reduced motion turns off.
  expect(runs).toEqual(["true", "false"])
})
