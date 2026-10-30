import type { AutomationInfo } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

test("opens Automations from the vertical sidebar, inspects gates, pauses/resumes, and deletes", async ({ page }) => {
  const now = Date.now()

  const automations: AutomationInfo[] = [
    {
      id: "aut_ci_watch",
      sessionID: "ses_rollout",
      name: "PR #482 CI watch",
      when: { type: "every", every: "30 seconds" },
      tz: "America/Los_Angeles",
      until: { type: "shell", run: "gh pr checks 482" },
      action: { type: "prompt", prompt: "Summarize any slow jobs once all checks pass." },
      status: "active",
      nextDueAt: now + 22_000,
      runCount: 0,
      lastFiredAt: now - 8_000,
      lastOutcome: "checked",
      lastOutput: "pending: unit (linux), e2e (app)",
      time: { created: now - 60_000, updated: now - 8_000 },
    },
    {
      id: "aut_morning",
      sessionID: "ses_rollout",
      name: "Weekday morning brief",
      when: { type: "cron", cron: "0 9 * * 1-5" },
      tz: "America/Los_Angeles",
      action: { type: "prompt", prompt: "Summarize overnight commits and open pull requests." },
      status: "active",
      nextDueAt: now + 14_400_000,
      runCount: 9,
      time: { created: now - 500_000, updated: now - 90_000 },
    },
  ]

  await mockWorkspace(page, {
    name: "opencode",
    sessions: [{ id: "ses_rollout", title: "PR #482 rollout" }],
    automations,
    seed: {
      settings: { appearance: { tabLayout: "vertical", sidebarOpen: true } },
    },
  })

  await page.goto(sessionHref("ses_rollout"))
  const nav = page.locator('[data-action="vertical-tabs-automations"]')
  await expect(nav).toBeVisible()
  await expect(nav).toContainText("Automations")
  await expect(nav).toContainText("2")

  await nav.click()
  await expect(page).toHaveURL(/\/automations$/)
  await expect(nav).toHaveAttribute("data-state", "pressed")

  const inspector = page.locator('[data-slot="automation-inspector"]')
  await expect(inspector).toContainText("PR #482 CI watch")
  await expect(inspector).toContainText("$ gh pr checks 482")
  await expect(inspector).toContainText("pending: unit (linux), e2e (app)")

  // Pause and resume update the status and sidebar badge count.
  const pauseBtn = page.locator('[data-action="automation-toggle-pause"]')
  await expect(pauseBtn).toHaveText("Pause")
  await pauseBtn.click()
  await expect(pauseBtn).toHaveText("Resume")
  await expect(nav).toContainText("1")

  await pauseBtn.click()
  await expect(pauseBtn).toHaveText("Pause")
  await expect(nav).toContainText("2")

  // Delete removes the automation after confirmation.
  await page.locator('[data-action="automation-delete"]').click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.locator('[data-automation-id="aut_ci_watch"]')).toHaveCount(0)
  await expect(inspector).toContainText("Weekday morning brief")
})
