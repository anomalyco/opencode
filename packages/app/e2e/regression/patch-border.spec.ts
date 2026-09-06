import { expect, test } from "@playwright/test"
import { createTwoFilesPatch } from "diff"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

test.use({
  deviceScaleFactor: 2,
  // Emulating DPR alone does not exercise Chromium's native hairline border rounding.
  launchOptions: { args: ["--force-device-scale-factor=2"] },
})

for (const width of [1400, 390]) {
  test(`patch file borders retain a full CSS pixel at ${width}px on high-density displays`, async ({ page }) => {
    const file = `src/${"long-directory/".repeat(12)}patch-border.ts`
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            "prt_border_patch",
            "patch",
            "completed",
            { patchText: "Update file" },
            {
              metadata: {
                files: [
                  {
                    file,
                    status: "modified",
                    additions: 1,
                    deletions: 1,
                    patch: createTwoFilesPatch(file, file, "const value = 1\n", "const value = 2\n"),
                  },
                ],
              },
            },
          ),
        ]),
      ],
      reducedMotion: true,
      viewport: { width, height: 900 },
    })
    await page.getByRole("button", { name: "Used 1 Patch", exact: true }).click()
    const patch = page.locator('[data-component="apply-patch-tool"]')
    const trigger = patch.getByRole("button", { name: /patch-border.ts/ })
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(trigger).toHaveCSS("height", "32px")
    for (const side of ["top", "right", "bottom", "left"]) {
      await expect(trigger).toHaveCSS(`border-${side}-width`, "1px")
    }

    const box = await trigger.boundingBox()
    await trigger.hover()
    expect(await trigger.boundingBox()).toEqual(box)
    await page.mouse.move(0, 0)
    expect(await trigger.boundingBox()).toEqual(box)

    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    const content = patch.locator('[data-slot="accordion-content"]')
    await expect(content).toBeVisible()
    for (const side of ["left", "right", "bottom"]) {
      await expect(content).toHaveCSS(`border-${side}-width`, "1px")
    }
    await expect(content).toHaveCSS("border-top-width", "0px")
    await trigger.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
  })
}
