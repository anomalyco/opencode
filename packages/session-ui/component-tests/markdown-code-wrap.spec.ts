import type { Locator } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

story(
  "code blocks offer Wrap only when a line overflows, and a block's choice overrides the setting",
  async ({ mount, page }) => {
    const root = await mount("components-markdown--long-code-lines")
    await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
    const blocks = root.locator('[data-component="markdown-code"]')
    const [shell, ts, short] = [blocks.nth(0), blocks.nth(1), blocks.nth(2)]
    const pre = (block: Locator) => block.locator(":scope > pre")
    const wrapButton = (block: Locator) => block.locator('[data-slot="markdown-wrap-button"] button')

    await expect(shell).toHaveAttribute("data-code-overflow", "")
    await expect(ts).toHaveAttribute("data-code-overflow", "")
    await expect(short).not.toHaveAttribute("data-code-overflow", "")
    await short.hover()
    await expect(wrapButton(short)).toBeHidden()

    await shell.hover()
    await wrapButton(shell).click()
    await expect(pre(shell)).toHaveCSS("white-space", "pre-wrap")
    await expect(pre(ts)).toHaveCSS("white-space", "pre")
    // A wrapped block still measures its unwrapped lines, so it keeps the button to unwrap.
    await expect(shell).toHaveAttribute("data-code-overflow", "")
    await expect(wrapButton(shell)).toHaveAccessibleName("Don't wrap lines")

    await page.getByLabel("Wrap code blocks setting").check()
    await expect(pre(ts)).toHaveCSS("white-space", "pre-wrap")
    await ts.hover()
    await wrapButton(ts).click()
    await expect(pre(ts)).toHaveCSS("white-space", "pre")
    await expect(pre(shell)).toHaveCSS("white-space", "pre-wrap")

    // Choosing the default again follows the setting from then on.
    await wrapButton(ts).click()
    await page.getByLabel("Wrap code blocks setting").uncheck()
    await expect(pre(ts)).toHaveCSS("white-space", "pre")
  },
)

story("code block actions sit in the block's top corner over the block's own background", async ({ mount, page }) => {
  const root = await mount("components-markdown--long-code-lines")
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  const blocks = root.locator('[data-component="markdown-code"]')
  const toolbar = (block: Locator) => block.locator('[data-slot="markdown-code-toolbar"]')

  const fill = (block: Locator) =>
    toolbar(block).evaluate((element) => getComputedStyle(element, "::before").backgroundColor)

  const background = (block: Locator) =>
    block.locator(":scope > pre").evaluate((element) => getComputedStyle(element).backgroundColor)

  // A shell block and a TypeScript block have different backgrounds; each fill matches its own.
  for (const block of [blocks.nth(0), blocks.nth(1)]) {
    const code = (await block.locator(":scope > pre").boundingBox())!
    await expect(toolbar(block)).toHaveCSS("opacity", "0")
    await page.mouse.move(code.x + 40, code.y + code.height / 2)
    await expect(toolbar(block)).toHaveCSS("opacity", "1")
    const box = (await toolbar(block).boundingBox())!
    expect(box.y).toBeLessThan(code.y + 8)
    expect(code.x + code.width - (box.x + box.width)).toBeLessThan(8)
    expect(await fill(block)).toBe(await background(block))
  }

  // A clicked button keeps focus, which must not keep the actions shown once the pointer leaves.
  const block = blocks.nth(1)
  await block.getByRole("button", { name: "Copy", exact: true }).click()
  await page.mouse.move(4, 4)
  await expect(toolbar(block)).toHaveCSS("opacity", "0")

  await page.keyboard.press("Shift+Tab")
  await expect(toolbar(block)).toHaveCSS("opacity", "1")
})
