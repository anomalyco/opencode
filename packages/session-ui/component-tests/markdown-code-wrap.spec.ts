import { expect, story } from "../../stories/playwright/story"

story(
  "code blocks offer Wrap only when a line overflows, and a block's choice overrides the setting",
  async ({ mount, page }) => {
    const root = await mount("components-markdown--long-code-lines")
    await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
    const blocks = root.locator('[data-component="markdown-code"]')
    const [shell, ts, short] = [blocks.nth(0), blocks.nth(1), blocks.nth(2)]
    const pre = (block: typeof shell) => block.locator(":scope > pre")
    const wrapButton = (block: typeof shell) => block.locator('[data-slot="markdown-wrap-button"] button')

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
