import type { Locator } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const measureBubble = (bubble: Locator) =>
  bubble.evaluate((element) => {
    const menu = element.querySelector('[data-slot="user-message-menu"]')
    const chevron = menu?.querySelector("button")?.getBoundingClientRect()

    if (!menu || !chevron) throw new Error("The chevron is not rendered")

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (menu.contains(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })

    const rects: DOMRect[] = []

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      rects.push(...range.getClientRects())
    }

    const visible = rects.filter((rect) => rect.width > 0)

    return {
      rows: new Set(visible.map((rect) => Math.round(rect.top))).size,
      overlaps: visible.filter(
        (rect) =>
          rect.left < chevron.right &&
          rect.right > chevron.left &&
          rect.top < chevron.bottom &&
          rect.bottom > chevron.top,
      ).length,
    }
  })

for (const [cap, id, viewport] of [
  ["percentage cap", "current-prompt-message--width-cap-wrapping", { width: 700, height: 700 }],
  ["character cap", "current-prompt-message--character-cap-wrapping", { width: 900, height: 700 }],
] as const) {
  story.describe(`user message bubble at the ${cap}`, () => {
    story.use({ hasTouch: true, isMobile: true, viewport })

    story("keeps a prompt that fits in the bubble on one line", async ({ mount, page }) => {
      const root = await mount(id)
      expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)
      await page.evaluate(() => document.fonts.ready.then(() => undefined))

      const bubble = root.locator('[data-slot="user-message-text"]')

      const report = await measureBubble(bubble)

      // The 20px the always-shown chevron needs must come out of the bubble, not out of the text's line box.
      expect(report.rows).toBe(1)
      expect(report.overlaps).toBe(0)
    })
  })
}
