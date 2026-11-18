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

    // Choosing the default again follows the setting from then on. The page cannot scroll up to keep the shrunken block's
    // footer under the pointer, so point at the block again first.
    await ts.hover()
    await wrapButton(ts).click()
    await page.getByLabel("Wrap code blocks setting").uncheck()
    await expect(pre(ts)).toHaveCSS("white-space", "pre")
  },
)

story("wrapping a block in the timeline keeps its Wrap button under the pointer", async ({ mount, page }) => {
  await page.setViewportSize({ width: 900, height: 420 })
  const root = await mount("current-session-code-blocks--long-lines")
  const block = root.locator('[data-component="markdown-code"]').nth(1)
  await expect(block).toHaveAttribute("data-code-overflow", "")
  // Like a session opened at its latest reply, so there is room above to scroll back.
  await page.getByTestId("code-blocks-scroll").evaluate((scroll) => scroll.scrollTo({ top: scroll.scrollHeight }))
  const button = block.locator('[data-slot="markdown-wrap-button"] button')

  await block.hover()
  const before = (await button.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect(button).toHaveAccessibleName("Don't wrap lines")
  expect(Math.abs((await button.boundingBox())!.y - before.y)).toBeLessThan(1)

  // Unwrapping shrinks the block, so without the scroll the footer would leave the pointer and hide.
  await page.mouse.down()
  await page.mouse.up()
  await expect(button).toHaveAccessibleName("Wrap lines")
  expect(Math.abs((await button.boundingBox())!.y - before.y)).toBeLessThan(1)
  await expect(block.locator('[data-slot="markdown-code-footer"]')).toHaveCSS("opacity", "1")
})

story(
  "code block actions sit under the block and stay while the pointer moves down to them",
  async ({ mount, page }) => {
    const root = await mount("components-markdown--long-code-lines")
    await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
    const block = root.locator('[data-component="markdown-code"]').nth(1)
    const footer = block.locator('[data-slot="markdown-code-footer"]')
    const code = (await block.locator(":scope > pre").boundingBox())!

    await expect(footer).toHaveCSS("opacity", "0")
    await page.mouse.move(code.x + 40, code.y + code.height / 2)
    await expect(footer).toHaveCSS("opacity", "1")
    expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual(code.y + code.height)

    // Down through the margin from the block's start edge, then across to the buttons at its end.
    await page.mouse.move(code.x + 40, code.y + code.height + 4, { steps: 4 })
    await expect(footer).toHaveCSS("opacity", "1")
    const copy = (await footer.getByRole("button", { name: "Copy", exact: true }).boundingBox())!
    await page.mouse.move(copy.x + copy.width / 2, copy.y + copy.height / 2, { steps: 8 })
    await expect(footer).toHaveCSS("opacity", "1")

    // A clicked button keeps focus, which must not keep the footer shown once the pointer leaves.
    await page.mouse.down()
    await page.mouse.up()
    await page.mouse.move(code.x + 40, code.y + code.height + 60)
    await expect(footer).toHaveCSS("opacity", "0")

    await page.keyboard.press("Shift+Tab")
    await expect(footer).toHaveCSS("opacity", "1")
  },
)
