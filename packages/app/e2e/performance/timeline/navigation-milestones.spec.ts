import type { NavigationMilestoneSample } from "./navigation-milestones"
import { measureNavigationMilestones } from "./navigation-milestones"
import { benchmark, expect } from "../benchmark"

benchmark(
  "navigation milestones start at mousedown and wait for the expected ready controls",
  async ({ page, report }) => {
    await page.setContent('<button id="open">Open</button><input id="editor" disabled><span id="model">Loading</span>')
    const result = await measureNavigationMilestones(page, {
      triggerSelector: "#open",
      milestones: { editor: { selector: "#editor:enabled:focus" }, model: { selector: "#model", text: "Ready model" } },
      navigate: async () => {
        await page.getByRole("button", { name: "Open", exact: true }).dispatchEvent("mousedown", { button: 0 })
        await page.locator("#editor").evaluate((element: HTMLInputElement) => {
          element.disabled = false
          element.focus()
        })
        await page.waitForFunction(() => {
          const samples = (window as Window & { __navigationMilestones?: { samples: NavigationMilestoneSample[] } })
            .__navigationMilestones?.samples
          return samples?.some((sample) => sample.milestones.editor && !sample.milestones.model)
        })
        await page.locator("#model").evaluate((element) => {
          element.textContent = "Ready model"
        })
      },
    })
    expect(result.summary.all.firstObservedMs).not.toBeNull()
    expect(result.summary.all.firstObservedMs).toBeGreaterThan(result.summary.milestones.editor.firstObservedMs!)
    expect(await page.evaluate(() => "__navigationMilestones" in window)).toBe(false)
    report(result)
  },
)
