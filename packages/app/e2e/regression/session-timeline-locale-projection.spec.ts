import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

for (const profile of [
  { locale: "de", label: "Erkundet" },
  { locale: "ar", label: "تم الاستكشاف" },
] as const) {
  test(`projects translated context status in ${profile.locale}`, async ({ page }) => {
    const ids = [`prt_locale_${profile.locale}_01_read`, `prt_locale_${profile.locale}_02_glob`]
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(ids[0]!, "read", "completed", { filePath: "src/a.ts" }),
          toolPart(ids[1]!, "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        ]),
      ],
      locale: profile.locale,
    })

    const group = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
    await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", profile.label)
    await expect(page.locator("html")).toHaveAttribute("lang", profile.locale)
  })
}
