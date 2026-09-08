import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"

test("context opens independently, exports its session, and restores the closed panel", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: fixture.sessions,
    provider: fixture.provider,
    pageMessages,
  })
  await installStressSessionTabs(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expect(page.getByRole("heading", { name: fixture.expected.sourceTitle, exact: true })).toBeVisible()
  const toggle = page.getByRole("button", { name: "View context usage", exact: true })
  await toggle.click()
  const context = page.getByRole("tabpanel", { name: "Context", exact: true })
  await expect(context.getByText("Total Tokens", { exact: true })).toBeVisible()
  await expect(context.getByText(fixture.expected.sourceTitle, { exact: true })).toBeVisible()
  await expect(context.getByText("Raw messages", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("context-extension.png") })
  const pending = page.waitForEvent("download")
  await context.getByRole("button", { name: "Export session", exact: true }).click()
  const download = await pending
  const exported: { info: { id: string }; messages: { id: string }[] } = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  )
  expect(exported.info.id).toBe(fixture.sourceID)
  expect(exported.messages.length).toBeGreaterThan(0)
  expect(new Set(exported.messages.map((message) => message.id)).size).toBe(exported.messages.length)
  await toggle.click()
  await expect(page.getByRole("tab", { name: "Context", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await toggle.click()
  await expect(context.getByText(fixture.expected.sourceTitle, { exact: true })).toBeVisible()
})
