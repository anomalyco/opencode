import { test, expect } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs } from "../performance/timeline/timeline-test-helpers"

test("independent panel instances retain drafts, close explicitly, and obey plugin availability", async ({
  page,
}, info) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page)
  await page.goto("/e2e/extensions/fixture.html")
  await expect(page.getByRole("heading", { name: fixture.expected.sourceTitle, exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open notes", exact: true }).click()
  await page.getByRole("textbox", { name: "Notes draft", exact: true }).fill("Retained draft")
  await page.getByRole("tab", { name: "Results", exact: true }).click()
  await expect(page.getByText("Closed notes: 0", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Notes", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Notes draft", exact: true })).toHaveValue("Retained draft")
  await page
    .locator('[data-slot="tabs-trigger-wrapper"][data-value="extension:test.panels:notes"]')
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await page.getByRole("tab", { name: "Results", exact: true }).click()
  await expect(page.getByText("Closed notes: 1", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open notes", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Notes draft", exact: true })).toHaveValue("Retained draft")
  await page.screenshot({ path: info.outputPath("extension-panels.png") })
  await page
    .getByRole("tab", { name: "Results", exact: true })
    .dragTo(page.getByRole("tab", { name: "Notes", exact: true }))
  await expect(page.getByRole("tab", { name: /^(Notes|Results)$/ })).toHaveText(["Results", "Notes"])
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page.locator('header a[href$="/ses_smoke_source"]').click()
  await page.getByRole("button", { name: "Open notes", exact: true }).click()
  await expect(page.getByRole("tab", { name: /^(Notes|Results)$/ })).toHaveText(["Results", "Notes"])
  await expect(page.getByRole("textbox", { name: "Notes draft", exact: true })).toHaveValue("Retained draft")
  await page.getByRole("button", { name: "Toggle contribution", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Toggle contribution", exact: true }).click()
  await page.getByRole("button", { name: "Open notes", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Notes draft", exact: true })).toHaveValue("Retained draft")
})
