import { benchmark, expect } from "./benchmark"
import { openCommandPalette, paletteSession } from "../utils/command-palette"

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  traceScope: "interaction",
  trace: "off",
  video: "off",
})

for (const { home, known } of [
  { home: false, known: false },
  { home: true, known: false },
  { home: false, known: true },
  { home: true, known: true },
]) {
  benchmark(
    `${known ? "known session" : "command"} lookup from ${home ? "home" : "session"}`,
    async ({ page, report }) => {
      const { dialog, input } = await openCommandPalette(
        page,
        home,
        known
          ? [
              ...Array.from({ length: 49 }, (_, index) => ({
                ...paletteSession,
                id: `ses_palette_earlier_${index}`,
                title: `Earlier task ${index + 1}`,
                time: { ...paletteSession.time, updated: paletteSession.time.updated - index - 1 },
              })),
              paletteSession,
            ]
          : undefined,
      )

      const title = known ? paletteSession.title : home ? "Open settings" : "Copy Session ID"
      const query = known ? "palette fixture" : home ? "open settings" : "copy session"

      if (known) {
        await expect(dialog.getByRole("option", { name: /Palette fixture session/ })).toBeVisible()
        await page.route(/\/api\/(session\?|fs\/find\?)/, async (route) => {
          // Controlled server latency, not synchronization: completion is asserted below.
          await new Promise((resolve) => setTimeout(resolve, 750))
          await route.fallback()
        })
      }

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
      await expect(
        dialog.getByRole("option", { name: new RegExp(`${known ? "" : "^"}${title}(?:$| )`) }),
      ).toHaveAttribute("aria-selected", "true")

      const result = await page.evaluate(() =>
        performance.getEntriesByName("palette-result").map((entry) => entry.duration),
      )

      expect(result).toHaveLength(1)
      report(
        { inputToResultMs: result[0] },
        {
          home,
          query,
          data: known ? "fixture; 50 known sessions; 750ms search responses" : "fixture; immediate server responses",
        },
      )
    },
  )
}
