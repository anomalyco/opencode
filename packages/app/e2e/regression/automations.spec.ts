import type { AutomationInfo } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"

test("inspects event and timer automations and manages the selected row", async ({ page }) => {
  const directory = "C:/OpenCode/Atlas"
  const now = Date.UTC(2026, 10, 17, 9, 10)
  const base = { projectID: "proj_atlas", directory: `${directory}/release`, tz: "UTC", sessionID: "ses_release", status: "active", runCount: 3, time: {created: now, updated: now} } as const
  const automations: AutomationInfo[] = [
    { ...base, id: "aut_deploy", name: "Release health watch", trigger: {type: "event", server: "deployments", event: "deployment.finished", args: {environment: "staging"}}, action: {type: "code", code: 'if (event.data.status !== "failed") return\nreturn { send: { prompt: "Review the failed deployment." } }'}, lastRunAt: now, lastOutcome: "fired", lastOutput: "Staging deployment succeeded. No message sent." },
    { ...base, id: "aut_brief", name: "Morning release brief", trigger: {type: "cron", cron: "0 9 * * 1-5"}, action: {type: "prompt", prompt: "Summarize release activity since yesterday.", to: {session: "ses_brief"}}, nextDueAt: now + 86_400_000 },
    { ...base, id: "aut_docs", name: "Documentation review", status: "paused", trigger: {type: "every", every: "1 day"}, action: {type: "prompt", prompt: "Review the documentation changes.", to: {subagent: "reviewer"}} },
  ]
  await mockWorkspace(page, {name: "Atlas", directory, commands: [{name: "automation"}], sessions: [{id: "ses_release", title: "Release planning"}, {id: "ses_brief", title: "Release notes"}], automations,
    seed: {theme: {id: "oc-2", scheme: "dark"}, settings: {appearance: {tabLayout: "vertical", sidebarOpen: true}}},
  })
  await page.goto(sessionHref("ses_release"))
  const nav = page.getByRole("button", {name: "Automations", exact: true})
  await nav.click()
  const detail = page.getByRole("article")
  await page.getByRole("button", {name: /Release health watch/}).click()
  await expect(detail.getByRole("heading", {name: "Release health watch"})).toBeVisible()
  await expect(detail.getByText("deployment.finished", {exact: true})).toBeVisible()
  await expect(detail.getByText('"staging"', {exact: false})).toBeVisible()
  await expect(detail.getByText("Next run")).toHaveCount(0)
  await expect(detail.getByText("Only if the code returns send", {exact: false})).toBeVisible()
  await expect(detail.getByText(`${directory}/release`, {exact: true})).toBeVisible()
  await expect(detail.getByText("Staging deployment succeeded. No message sent.")).toBeVisible()
  await detail.getByRole("button", {name: "Pause", exact: true}).click()
  await expect(nav).toContainText("1")
  await detail.getByRole("button", {name: "Resume", exact: true}).click()
  await expect(nav).toContainText("2")
  await detail.getByRole("button", {name: "Delete automation"}).click()
  await page.getByRole("dialog").getByRole("button", {name: "Delete", exact: true}).click()
  await expect(page.getByRole("button", {name: /Release health watch/})).toHaveCount(0)
  await expect(detail.getByText("Next run")).toBeVisible()
  await expect(detail.getByRole("button", {name: "Release planning"})).toBeVisible()
  await expect(detail.getByRole("button", {name: "Release notes"})).toBeVisible()
  await page.getByRole("button", {name: /Documentation review/}).click()
  await expect(detail.getByText("New quiet child · reviewer")).toBeVisible()
  await page.getByRole("button", {name: "New automation"}).click()
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText(/\/automation/)
})

test("discovers an enabled empty project and withdraws the entry when the server removes its command", async ({page}) => {
  let enabled = true
  const { push, directory } = await mockWorkspace(page, {name: "Empty", commands: () => enabled ? [{name: "automation"}] : []})
  await page.goto("/automations")
  await expect(page.getByRole("heading", {name: "No automations yet"})).toBeVisible()
  enabled = false
  await push({ type: "command.updated", location: {directory}, data: {} })
  await expect(page.getByText("Automations aren’t available in your open projects.")).toBeVisible()
  await expect(page.getByRole("button", {name: "Automations", exact: true})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "New automation"})).toHaveCount(0)
})
