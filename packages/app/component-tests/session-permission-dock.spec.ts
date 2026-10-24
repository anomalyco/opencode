import { expect, story } from "../../storybook/playwright/story"

story("keeps permission actions reachable while long commands scroll", async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const component = await mount("app-current-session-surface--long-permission-request")
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const dock = component.locator('[data-component="dock-prompt"][data-kind="permission"]')
  const patterns = dock.locator('[data-slot="permission-patterns"]')
  const allow = dock.getByRole("button", { name: "Allow once", exact: true })
  await expect(allow).toBeVisible()
  await expect(allow).toBeInViewport({ ratio: 1 })
  await expect(allow).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath("permission-dock-mobile.png") })
  expect(await patterns.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await patterns.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect.poll(() => patterns.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const name of ["Deny", "Allow always", "Allow once"]) {
    await expect(dock.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 })
  }
  await allow.click()
  await expect(dock).toHaveCount(0)
})
