import { benchmark, expect } from "../benchmark"
import { measureSessionSwitch } from "./session-tab-switch-probe"
import type { SessionSwitchSample } from "./session-tab-switch-metrics"

benchmark("starts at mousedown and excludes hidden or unfinished destination content", async ({ page, report }) => {
  await page.setContent(`
    <a href="/session/destination">Destination</a>
    <div class="scroll-view__viewport" style="height:200px;overflow:auto">
      <div data-timeline-row="message" data-timeline-key="row" data-message-id="source">
        <div data-timeline-part-id="answer"><div data-component="markdown">Destination answer</div></div>
      </div>
    </div>
  `)
  await page.evaluate(() => {
    document.querySelector("a")!.addEventListener("mousedown", () => {
      const row = document.querySelector<HTMLElement>("[data-message-id]")!
      row.dataset.messageId = "destination"
      row.style.visibility = "hidden"
    })
  })
  const result = await measureSessionSwitch(page, {
    destinationIDs: ["destination"],
    sourceIDs: ["source"],
    lastID: "destination",
    requiredPartID: "answer",
    requireBottomAnchor: false,
    href: "/session/destination",
    switch: async () => {
      // No click is dispatched: the probe must observe the event that activates tabs.
      await page.getByRole("link", { name: "Destination" }).dispatchEvent("mousedown", { button: 0 })
      await page.waitForFunction(() => {
        const host = window as Window & { __sessionSwitchProbe?: { samples: SessionSwitchSample[] } }
        return host.__sessionSwitchProbe?.samples.some((sample) => !sample.hasVisibleRows)
      })
      await page.locator("[data-message-id]").evaluate((row) => row.style.removeProperty("visibility"))
      await page.waitForFunction(() => {
        const host = window as Window & { __sessionSwitchProbe?: { samples: SessionSwitchSample[] } }
        return host.__sessionSwitchProbe?.samples.some(
          (sample) => sample.destination.length > 0 && sample.requiredPartVisible === false,
        )
      })
      const beforeClip = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>("[data-timeline-key]")!
        row.style.cssText = "height:10px;position:relative;overflow:clip"
        const answer = row.querySelector<HTMLElement>("[data-timeline-part-id]")!
        answer.style.cssText = "position:absolute;top:30px;width:150px"
        answer.querySelector('[data-component="markdown"]')!.setAttribute("data-markdown-ready", "")
        return (
          (window as Window & { __sessionSwitchProbe?: { samples: SessionSwitchSample[] } }).__sessionSwitchProbe
            ?.samples.length ?? 0
        )
      })
      await page.waitForFunction((count) => {
        const host = window as Window & { __sessionSwitchProbe?: { samples: SessionSwitchSample[] } }
        return host.__sessionSwitchProbe?.samples.slice(count).some((sample) => sample.requiredPartVisible === false)
      }, beforeClip)
      await page.locator("[data-timeline-key]").evaluate((row) => {
        row.style.height = "100px"
      })
    },
  })
  expect(result.blankSamples).toBeGreaterThan(0)
  expect(result.firstCorrectObservedMs).not.toBeNull()
  expect(result.stableObservedMs).not.toBeNull()
  expect(result.firstCorrectObservedMs).toBeGreaterThan(result.firstDestinationObservedMs!)
  report(result)
})
