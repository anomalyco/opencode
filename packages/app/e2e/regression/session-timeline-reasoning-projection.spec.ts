import { expect, test } from "@playwright/test"
import {
  assistantID,
  assistantMessage,
  reasoningPart,
  setupTimeline,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("changes live reasoning through Settings and persists Hidden, Compact, and Full", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          reasoningPart(
            "prt_reasoning_settings",
            "## Inspecting stability\n\nThe selected mode controls these details.",
          ),
        ],
        { completed: false },
      ),
    ],
  })
  const part = page.locator(`[data-timeline-part-id="${assistantID}:reasoning:0"]`)
  await expect(part.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  const settings = page.getByTestId("settings-screen")
  const select = settings.locator('[data-action="settings-reasoning-mode"] [data-component="select-v2"]')
  for (const label of ["Full", "Hidden", "Compact"] as const) {
    await page.keyboard.press("Control+,")
    await expect(settings.getByText("Model reasoning", { exact: true })).toBeVisible()
    await expect(select).toHaveAttribute("aria-expanded", "false")
    await select.click()
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Hidden", "Compact", "Full"])
    await page.getByRole("option", { name: label, exact: true }).click()
    await expect(select).toHaveText(label)
    await expect(select).toHaveAttribute("aria-expanded", "false")
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.reasoningMode))
      .toBe(label.toLowerCase())
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(settings).toBeHidden()
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(label === "Hidden" ? 0 : 1)
    await expect(part).toHaveCount(label === "Hidden" ? 0 : 1)
    if (label === "Hidden") {
      await expect(page.getByText("The selected mode controls these details.", { exact: true })).toBeHidden()
      continue
    }
    await expect(part.getByRole("button")).toHaveAttribute("aria-expanded", String(label === "Full"))
    if (label === "Full")
      await expect(part.getByText("The selected mode controls these details.", { exact: true })).toBeVisible()
    if (label === "Compact") {
      await expect(part.getByRole("button")).toContainText("Inspecting stability")
      await expect(part.getByText("The selected mode controls these details.", { exact: true })).toBeHidden()
    }
  }
  await page.keyboard.press("Control+,")
  await expect(select).toHaveText("Compact")
})

// The persisted boolean migrates to compact (false) or full (true).
for (const summaries of [false, true]) {
  for (const profile of ["none", "blank", "heading", "tool", "text"] as const) {
    test(`projects legacy ${summaries ? "full" : "compact"} reasoning with ${profile}`, async ({ page }) => {
      await setupTimeline(page, {
        messages: [
          userMessage(),
          assistantMessage(
            [
              ...(profile === "none"
                ? []
                : [
                    reasoningPart(
                      `prt_reasoning_${summaries}_${profile}`,
                      profile === "blank"
                        ? "   "
                        : "## Inspecting stability\n\nI will inspect the timeline before changing its state.",
                    ),
                  ]),
              ...(profile === "tool"
                ? [toolPart(`prt_reasoning_tool_${summaries}`, "skill", "running", { name: "inspect" })]
                : []),
              ...(profile === "text" ? [textPart(`prt_reasoning_text_${summaries}`, "The timeline is stable.")] : []),
            ],
            { completed: false },
          ),
        ],
        settings: { showReasoningSummaries: summaries },
      })
      const part = page.locator(`[data-timeline-part-id="${assistantID}:reasoning:0"]`)
      await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(
        profile === "blank" || profile === "heading" ? 1 : 0,
      )
      if (profile === "none") {
        await expect(part).toHaveCount(0)
        return
      }
      if (profile === "blank") {
        await expect(part).toContainText("Thinking")
        await expect(part.getByRole("heading")).toHaveCount(0)
        return
      }
      if (profile === "tool") {
        const group = page.locator('[data-component="collapsed-tool-group"]')
        const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
        await expect(used).toContainText("UsedSkill")
        await expect(used).toHaveAttribute("aria-expanded", "false")
        await expect(page.getByText("Inspecting stability", { exact: true })).toBeHidden()
        await expect(group.locator('[data-component="tag"]')).toHaveText("1")
        await used.click()
        await expect(used).toHaveAttribute("aria-expanded", "true")
        await expect(group.locator(`[data-timeline-part-id="prt_reasoning_tool_${summaries}"]`)).toBeVisible()
        await expect(group.locator('[data-component="reasoning-part"]')).toHaveCount(1)
      }
      if (profile === "text") await expect(page.getByText("The timeline is stable.", { exact: true })).toBeVisible()
      const trigger = part.locator('[data-slot="collapsible-trigger"]')
      const body = part.getByText("I will inspect the timeline before changing its state.", { exact: true })
      await expect(trigger).toContainText(profile === "heading" ? "Thinking" : "Thought")
      await expect(trigger).toHaveAttribute("aria-expanded", String(summaries))
      if (!summaries) {
        await expect(body).toBeHidden()
        if (profile === "heading") await expect(trigger).toContainText("Inspecting stability")
        await trigger.click()
        await expect(trigger).toHaveAttribute("aria-expanded", "true")
      }
      await expect(body).toBeVisible()
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(body).toBeHidden()
      if (profile !== "heading") await expect(trigger).not.toContainText("Inspecting stability")
    })
  }
}

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
