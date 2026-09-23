import { expect, story } from "../../storybook/playwright/story"

for (const theme of ["light", "dark"]) {
  story(`keeps the Open in border visible without hovering (${theme})`, async ({ mount, page }, testInfo) => {
    const component = await mount("ui-split-button--open-in", { globals: { theme } })
    const control = component.locator('[data-component="split-button-v2"]')
    await page.mouse.move(0, 0)
    await expect(control).toBeVisible()
    await expect(control).not.toHaveCSS("box-shadow", "none")
    const border = await control.evaluate((element) => getComputedStyle(element).boxShadow)

    await component.getByRole("button", { name: "Open options" }).hover()
    await expect(control).toHaveCSS("box-shadow", border)
    await page.mouse.move(0, 0)
    await expect(control).toHaveCSS("box-shadow", border)
    await control.screenshot({ path: testInfo.outputPath(`open-in-${theme}.png`) })
  })
}
