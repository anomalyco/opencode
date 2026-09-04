import { expect, test } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

test("keeps notices visible outside Used and removes their grouped option", async ({ page }, info) => {
  await setupTimeline(page, {
    reducedMotion: true,
    sessionMessages: [
      { id: "msg_user", type: "user", text: "Inspect the project", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_read",
            name: "read",
            state: {
              status: "completed",
              input: { path: "src/example.ts" },
              content: [{ type: "text", text: "export const example = true" }],
              metadata: {},
            },
            time: { created: 2, completed: 3 },
          },
        ],
        time: { created: 2, completed: 3 },
      },
      { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 4 } },
      { id: "msg_skill", type: "skill", skill: "review", name: "Review", text: "instructions", time: { created: 5 } },
    ],
  })

  const used = page.getByRole("button", { name: "Used 1 Read", exact: true })
  const notices = page.locator('[data-slot="session-timeline-notice"]')
  await expect(used).toHaveAttribute("aria-expanded", "false")
  await expect(notices).toHaveText([/^Agent changed\s*Explore$/, /Skill · Review/])
  await page.screenshot({ path: info.outputPath("notices-visible.png"), animations: "disabled" })
  await used.click()
  await expect(used).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByText("example.ts", { exact: true })).toBeVisible()
  await used.press("Enter")
  await expect(used).toHaveAttribute("aria-expanded", "false")
  await expect(used).toBeFocused()
  await expect(notices).toHaveText([/^Agent changed\s*Explore$/, /Skill · Review/])

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("button", { name: "Advanced", exact: true }).click()
  await settings.getByRole("button", { name: "Notices Placement Separate", exact: true }).click()
  await expect(page.getByRole("option")).toHaveText(["Separate", "Hidden"])
  await page.screenshot({ path: info.outputPath("notice-options.png"), animations: "disabled" })
  await page.getByRole("option", { name: "Hidden", exact: true }).click()
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(settings).toBeHidden()
  await expect(notices).toHaveCount(0)
  await expect(used).toHaveAttribute("aria-expanded", "false")
})
