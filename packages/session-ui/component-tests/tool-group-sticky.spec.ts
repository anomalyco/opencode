import { expect, story } from "../../stories/playwright/story"

story("keeps the open Used header below the session title while scrolling", async ({ mount }) => {
  const root = await mount("current-tool-group--sticky-header", { args: { height: "720" } })
  const scroller = root.locator('[data-story="sticky-header-scroll"]')
  const header = root.getByRole("button", { name: "Used 37 Write, Shell, Grep, Edit", exact: true })

  const top = (locator: typeof header) =>
    locator.evaluate((node) => {
      const scroller = node.closest('[data-story="sticky-header-scroll"]')!

      return node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })

  const fade = () => header.evaluate((node) => getComputedStyle(node, "::after").opacity)

  expect(await scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 2)).toBe(true)
  await expect.poll(fade).toBe("0")
  await scroller.evaluate((node) => (node.scrollTop = 900))
  await expect.poll(() => top(header)).toBe(48)
  // Content passing under the stuck header fades out instead of being cut.
  await expect.poll(fade).toBe("1")

  // Nested file headers stack below the stuck Used header instead of covering it.
  const file = root.locator('[data-component="sticky-accordion-header"]').filter({ hasText: "model.ts" })
  // Outside a timeline row the diff sizes itself only after it renders on screen (content-visibility: auto),
  // and a header can stick only while its diff extends below it.
  await expect
    .poll(() => file.evaluate((node) => node.parentElement!.getBoundingClientRect().height))
    .toBeGreaterThan(400)
  await file.evaluate((node) => {
    const scroller = node.closest<HTMLElement>('[data-story="sticky-header-scroll"]')!
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 60
  })
  await expect.poll(() => top(header)).toBe(48)
  await expect.poll(() => top(file)).toBe(84)

  await header.click()
  await expect(header).toHaveAttribute("aria-expanded", "false")
  await expect.poll(() => top(header)).toBe(48)
  await expect(root.locator('[data-slot="context-tool-group-item"]')).toHaveCount(0)
})
