import { expect, story } from "../../storybook/playwright/story"

story("enables Any only after confirmation and supports resetting the preview", async ({ mount }) => {
  const component = await mount("app-current-session-surface--web-search-request")
  const card = component.getByRole("region", { name: "Third-party web search" })
  await expect(card.getByRole("button", { name: "Enable", exact: true })).toBeEnabled()
  await expect(card.getByRole("button", { name: "Search provider Any", exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Enable", exact: true }).click()
  await expect(component.getByRole("status")).toHaveText("Web search selection (local only): random")
  await expect(card).toHaveCount(0)
  await component.getByRole("button", { name: "Reset", exact: true }).click()
  await expect(card.getByRole("button", { name: "Enable", exact: true })).toBeEnabled()
})

story("declining search is an explicit disabled selection", async ({ mount }) => {
  const component = await mount("app-current-session-surface--web-search-request")
  const card = component.getByRole("region", { name: "Third-party web search" })
  await card.getByRole("button", { name: "Don’t use search", exact: true }).click()
  await expect(component.getByRole("status")).toHaveText("Web search selection (local only): false")
  await expect(card).toHaveCount(0)
})

for (const width of [360, 1200]) {
  for (const direction of ["ltr", "rtl"]) {
    for (const theme of ["light", "dark"]) {
      story(`selects and confirms a provider at ${width}px in ${direction} ${theme}`, async ({ mount, page }) => {
        await page.setViewportSize({ width, height: 900 })
        const component = await mount("app-current-session-surface--web-search-request", {
          globals: { theme, direction },
        })
        const card = component.getByRole("region", { name: "Third-party web search" })
        const select = card.getByRole("button", { name: /^Search provider/ })
        await expect(select).toBeEnabled()
        await expect(card).toHaveCSS("direction", direction)
        expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
        await select.focus()
        await select.press("Enter")
        const list = page.getByRole("listbox", { name: "Search provider", exact: true })
        await expect(list).toHaveCSS("direction", direction)
        await list.getByRole("option", { name: "Parallel", exact: true }).click()
        await expect(select).toHaveText("Parallel")
        await expect(card).toBeVisible()
        await expect(component.getByRole("status")).toHaveText("Ready")
        await expect(select).toBeFocused()
        await select.press("Tab")
        await expect(card.getByRole("button", { name: "Don’t use search", exact: true })).toBeFocused()
        await page.keyboard.press("Tab")
        const enable = card.getByRole("button", { name: "Enable", exact: true })
        await expect(enable).toBeFocused()
        await enable.press("Enter")
        await expect(component.getByRole("status")).toHaveText("Web search selection (local only): parallel")
        await expect(card).toHaveCount(0)
      })
    }
  }
}
