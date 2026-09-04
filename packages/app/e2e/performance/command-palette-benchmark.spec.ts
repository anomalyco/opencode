import { benchmark, expect } from "./benchmark"
import { openCommandPalette } from "../utils/command-palette"

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  traceScope: "interaction",
  trace: "off",
  video: "off",
})

for (const home of [false, true]) {
  benchmark(`command lookup from ${home ? "home" : "session"}`, async ({ page, report }) => {
    const { dialog, input } = await openCommandPalette(page, home)
    const title = home ? "Open settings" : "Copy Session ID"
    const query = home ? "open settings" : "copy session"
    // Measure input-to-selected-result in the renderer, without assertion polling overhead.
    await input.evaluate((element, title) => {
      element.addEventListener(
        "input",
        () => {
          performance.mark("palette-input")
          const observer = new MutationObserver(() => {
            if (document.querySelectorAll('[role="dialog"] [role="option"]').length !== 1) return
            const selected = document.querySelector('[role="dialog"] [role="option"][aria-selected="true"]')
            if (!selected?.textContent?.includes(title)) return
            performance.measure("palette-result", "palette-input")
            observer.disconnect()
          })
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
        },
        { once: true, capture: true },
      )
    }, title)
    await input.fill(query)
    await expect(dialog.getByRole("option")).toHaveCount(1)
    await expect(dialog.getByRole("option", { name: new RegExp(`^${title}(?:$| )`) })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const result = await page.evaluate(() =>
      performance.getEntriesByName("palette-result").map((entry) => entry.duration),
    )
    expect(result).toHaveLength(1)
    report({ inputToResultMs: result[0] }, { home, query, data: "fixture; immediate server responses" })
  })
}
