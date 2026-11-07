import { expect, story } from "../../stories/playwright/story"

story("keeps the comment options button pressed while its menu is open", async ({ mount, page }) => {
  const component = await mount("ui-line-comment--display")
  const trigger = component.locator('[data-slot="line-comment-v2-overflow"]')
  const rest = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)

  await trigger.click()

  await expect(page.getByRole("menu")).toBeVisible()
  await expect(trigger).toHaveAttribute("data-expanded", "")
  await expect(trigger).not.toHaveCSS("background-color", rest)
})

story("autosizes compact comments without native field-sizing", async ({ mount, page }) => {
  // Mock only availability; disable native sizing so real layout exercises the JS fallback.
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS)

    CSS.supports = (property: string, value?: string) => {
      if (property === "field-sizing") return false

      return value === undefined ? supports(property) : supports(property, value)
    }
  })

  const component = await mount("ui-line-comment--editor", { args: { variant: "compact" } })
  const textarea = component.getByRole("textbox")

  await page.addStyleTag({
    content: '[data-layout="compact"] [data-slot="line-comment-v2-textarea"] { field-sizing: fixed !important; }',
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(textarea).toHaveCSS("height", "20px")

  await textarea.fill("First\nSecond\nThird")
  await expect(textarea).toHaveCSS("height", "60px")

  await textarea.clear()
  await expect(textarea).toHaveCSS("height", "20px")

  await textarea.fill(Array.from({ length: 20 }, () => "Line").join("\n"))
  await expect(textarea).toHaveCSS("height", "160px")
  await expect.poll(() => textarea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
})

story("completes compact optional comments with or without text", async ({ mount }) => {
  const component = await mount("ui-line-comment--editor", { args: { variant: "compact", allowEmpty: true } })
  const action = component.getByRole("button", { name: "Comment", exact: true })
  const result = component.getByRole("status", { name: "Editor result" })

  await expect(action).toBeEnabled()
  await action.click()
  await expect(result).toHaveText("Submitted:")

  await component.getByRole("textbox").fill("Keep this passage")
  await action.click()
  await expect(result).toHaveText("Submitted: Keep this passage")
})
