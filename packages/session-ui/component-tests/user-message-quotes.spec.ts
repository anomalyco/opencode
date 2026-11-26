import { expect, story } from "../../stories/playwright/story"

// Each story renders a case twice: with comment cards (inlineQuotes off), then inline (on).

story("shows a quote-only prompt as a bubble inline and as cards when the gate is off", async ({ mount }) => {
  const root = await mount("current-prompt-quotes--one-commented")
  const messages = root.locator('[data-component="user-message"]')

  await expect(messages.nth(0).locator('[data-component="attachment-card"]')).toHaveCount(1)
  await expect(messages.nth(0).locator('[data-slot="user-message-quotes"]')).toHaveCount(0)

  const bubble = messages.nth(1).locator('[data-slot="user-message-text"]')
  await expect(bubble.locator('[data-slot="user-message-quote"]')).toHaveText("gap-2 on the Projects section")
  await expect(bubble.locator('[data-slot="user-message-quote-comment"]')).toHaveText("drop it to gap 1")
  await expect(messages.nth(1).locator('[data-component="attachment-card"]')).toHaveCount(0)
})

story("puts the composer text before the quotes, each comment under its quote", async ({ mount }) => {
  const bubble = (await mount("current-prompt-quotes--mixed"))
    .locator('[data-component="user-message"]')
    .nth(1)
    .locator('[data-slot="user-message-text"]')

  await expect(bubble).toContainText("and run the sidebar story at 360px after")

  const order = await bubble.evaluate((element) => {
    const text = element.textContent ?? ""

    return [
      text.indexOf("and run the sidebar story"),
      text.indexOf("gap-2 on the Projects section"),
      text.indexOf("drop it to gap 1"),
      text.indexOf("gap-2 in the Pinned group"),
    ]
  })

  expect(order).toEqual([...order].sort((a, b) => a - b))
  await expect(bubble.locator('[data-slot="user-message-quote-group"]')).toHaveCount(3)
})

story("clamps a long quote, which opens and closes by click and keyboard", async ({ mount, page }) => {
  const bubble = (await mount("current-prompt-quotes--short-and-long"))
    .locator('[data-component="user-message"]')
    .nth(1)

  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const short = bubble.locator('[data-slot="user-message-quote-text"]').filter({ hasText: "The menu is hovered." })
  const long = bubble.locator('[data-slot="user-message-quote-text"]').filter({ hasText: "The scrollbar thumb" })

  await expect(short).not.toHaveAttribute("role", "button")
  await expect(long).toHaveAttribute("aria-expanded", "false")

  const muted = await long.evaluate((element) => getComputedStyle(element).color)
  await long.hover()
  await expect(long).not.toHaveCSS("color", muted)

  const clamped = await long.evaluate((element) => element.clientHeight)
  await long.click()
  await expect(long).toHaveAttribute("aria-expanded", "true")
  expect(await long.evaluate((element) => element.clientHeight)).toBeGreaterThan(clamped)

  await long.press("Enter")
  await expect(long).toHaveAttribute("aria-expanded", "false")
})

story("keeps a quote expandable after resizing its bubble", async ({ mount, page }) => {
  const message = (await mount("current-prompt-quotes--source", { args: { width: "840" } }))
    .locator('[data-component="user-message"]')
    .nth(1)

  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const quote = message.locator('[data-slot="user-message-quote-text"]').filter({ hasText: "Cannot find module" })

  await expect(quote).not.toHaveAttribute("role", "button")
  await message.evaluate((element) => {
    element.style.maxWidth = "240px"
  })
  await expect(quote).toHaveAttribute("aria-expanded", "false")
  await quote.click()
  await expect(quote).toHaveAttribute("aria-expanded", "true")
  expect(await quote.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(false)
})

story("folds the whole bubble, quotes included, with Collapse long messages", async ({ mount }) => {
  const message = (await mount("current-prompt-quotes--fold-and-expand"))
    .locator('[data-component="user-message"]')
    .nth(1)

  const fold = message.locator('[data-slot="user-message-fold"]')

  await expect(fold).toHaveAttribute("data-folded", "")
  await expect(fold.locator('[data-slot="user-message-quotes"]')).toHaveCount(1)

  await message.locator('[data-slot="user-message-fold-toggle"]').click()
  await expect(fold).not.toHaveAttribute("data-folded", "")
})

story("puts the bar at the start of a right-to-left message", async ({ mount }) => {
  const message = (await mount("current-prompt-quotes--all-cases-rtl"))
    .locator('[data-component="user-message"]')
    .nth(1)

  const quote = message.locator('[data-slot="user-message-quote"]').first()
  const text = quote.locator('[data-slot="user-message-quote-text"]')

  await expect(message.locator('[data-slot="user-message-text"]')).toHaveCSS("direction", "rtl")
  await expect(quote).toHaveCSS("border-right-width", "2px")
  expect(await text.evaluate((element) => getComputedStyle(element).textAlign)).toBe("right")
})
