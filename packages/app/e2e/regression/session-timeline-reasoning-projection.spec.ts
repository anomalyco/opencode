import { expect, test } from "@playwright/test"
import {
  assistantID,
  assistantMessage,
  reasoningPart,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("changes timeline presets and saves custom thinking details", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        reasoningPart("prt_reasoning_settings", "## Inspecting stability\n\nThe selected mode controls these details."),
      ]),
    ],
  })
  const part = page.locator(`[data-timeline-part-id="${assistantID}:reasoning:0"]`)
  const settings = page.getByTestId("settings-screen")
  await page.keyboard.press("Control+,")
  const slider = settings.getByRole("slider", { name: "Timeline detail", exact: true })
  await expect(slider).toBeEnabled()
  await slider.press("Home")
  for (const [index, name] of ["Messages only", "Quiet", "Compact", "Detailed", "Everything"].entries()) {
    if (index) await slider.press("ArrowRight")
    await expect(slider).toHaveValue(String(index))
    await expect(slider).toHaveAttribute("aria-valuetext", name)
  }
  await slider.press("End")
  await settings.getByRole("button", { name: "Advanced", exact: true }).click()
  const grouped = settings.getByRole("switch", { name: "Thinking grouped", exact: true })
  const collapsed = settings.getByRole("switch", { name: "Thinking collapsed", exact: true })
  await expect(grouped).not.toBeChecked()
  await expect(collapsed).not.toBeChecked()
  await settings.locator('[data-category="thinking"][data-field="placement"] [data-slot="switch-control"]').click()
  await settings.locator('[data-category="thinking"][data-field="details"] [data-slot="switch-control"]').click()
  await expect(grouped).toBeChecked()
  await expect(collapsed).toBeChecked()
  await expect(slider).toHaveAttribute("aria-valuetext", "Custom")
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.timelineDetail?.thinking),
    )
    .toEqual({ placement: "grouped", details: "collapsed" })
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(settings).toBeHidden()
  await page.getByRole("button", { name: "Used 1 Thought", exact: true }).click()
  await expect(part.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await part.getByRole("button").click()
  await expect(part.getByText("The selected mode controls these details.", { exact: true })).toBeVisible()
})

test("does not infer reasoning visibility from provider identity", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_provider_text", "No reasoning payload")], { completed: false }),
    ],
    settings: { showReasoningSummaries: true },
  })

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${assistantID}:text:0"]`)).toBeVisible()
})
