import { expect, test, type Locator, type Page } from "@playwright/test"
import { seed, sessionHref } from "../utils/app"
import { fixture, installStressSessionTabs, mockStressTimeline } from "../utils/session-fixture"

test.use({ viewport: { width: 1440, height: 900 } })

// Samples every frame of a click toggle until the edge has rested for 300 ms: the moving edge, and the gap from the
// element before it to the one after.
async function trace(page: Page, toggle: Locator, before: string, after: string) {
  const frames = page.evaluate(
    ([before, after]) =>
      new Promise<{ edge: number; gap?: number }[]>((resolve) => {
        const start = performance.now()
        const out: { edge: number; gap?: number }[] = []
        let changed: number | undefined

        const tick = (now: number) => {
          const a = document.querySelector(before)?.getBoundingClientRect()
          const b = document.querySelector(after)?.getBoundingClientRect()
          const edge = (a ?? b)!.right

          if (out.length && edge !== out.at(-1)!.edge) changed = now
          // A settled-closed panel leaves the row, so the gap only holds while it has width.
          out.push({ edge, gap: a && b && b.width > 0 ? b.left - a.right : undefined })

          if (changed === undefined ? now - start < 10_000 : now - changed < 300) return requestAnimationFrame(tick)
          resolve(out)
        }

        requestAnimationFrame(tick)
      }),
    [before, after] as const,
  )

  await toggle.click({ force: true })

  return frames
}

test("the content beside a panel follows the panel's edge on every frame of a toggle", async ({ page }) => {
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  // Half speed, so even a slow runner draws several frames of each flight.
  await seed(page, {
    settings: { appearance: { tabLayout: "vertical", sidebarOpen: true } },
    storage: { "opencode.motion.v2": { speed: 0.5 } },
  })
  await page.goto(sessionHref(fixture.targetID))
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle })).toBeVisible()

  const sidebar = page
    .locator(
      '[data-slot="vertical-tabs-sidebar"] button[aria-controls="vertical-tabs-sidebar"], [data-slot="collapsed-sidebar-toggle"] button[aria-controls="vertical-tabs-sidebar"]',
    )
    .locator("visible=true")
    .first()

  const review = page.locator('[data-slot="session-review-toggle"] button')

  const runs = [
    { toggle: sidebar, before: '[data-slot="vertical-tabs-mount"]', after: "main", gap: 0 },
    { toggle: sidebar, before: '[data-slot="vertical-tabs-mount"]', after: "main", gap: 0 },
    { toggle: review, before: '[data-slot="session-chat-panel"]', after: "#review-panel", gap: 8 },
    { toggle: review, before: '[data-slot="session-chat-panel"]', after: "#review-panel", gap: 8 },
  ]

  for (const run of runs) {
    const frames = await trace(page, run.toggle, run.before, run.after)
    const edges = frames.map((frame) => frame.edge)
    // The toggle animates over several frames rather than jumping to its end, and never doubles back.
    expect(new Set(edges.map(Math.round)).size).toBeGreaterThan(3)
    const steps = edges.slice(1).map((edge, index) => edge - edges[index])
    expect(steps.every((step) => step >= -0.5) || steps.every((step) => step <= 0.5)).toBe(true)
    frames.flatMap((frame) => frame.gap ?? []).forEach((gap) => expect(gap).toBeCloseTo(run.gap, 0))
  }
})
