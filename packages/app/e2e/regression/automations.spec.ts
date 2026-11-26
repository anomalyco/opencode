import type { AutomationInfo } from "@opencode/client/promise"
import { expect, test } from "@playwright/test"
import { project, provider, REMOTE_SERVER, seed, SERVER, sessionHref } from "../utils/app"
import { mockServers } from "../utils/mock-server"
import { mockWorkspace } from "../utils/workspace"

test("inspects event and timer automations and manages the selected row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/Atlas"
  const now = Date.UTC(2026, 10, 17, 9, 10)

  const base = {
    projectID: "proj_atlas",
    directory: `${directory}/release`,
    tz: "UTC",
    sessionID: "ses_release",
    status: "active",
    runCount: 3,
    time: { created: now, updated: now },
  } as const

  const automations: AutomationInfo[] = [
    {
      ...base,
      id: "aut_deploy",
      name: "Release health watch",
      trigger: { type: "event", server: "deployments", event: "deployment.finished", args: { environment: "staging" } },
      action: {
        type: "code",
        code: 'console.log(`Deployment status: ${event.data.status}`)\nif (event.data.status === "failed")\n  return { send: { prompt: "Review the failed deployment." } }',
      },
      lastRunAt: now,
      lastOutcome: "fired",
      lastOutput: "Deployment status: succeeded",
    },
    {
      ...base,
      id: "aut_brief",
      name: "Morning release brief",
      trigger: { type: "cron", cron: "0 9 * * 1-5" },
      action: { type: "prompt", prompt: "Summarize release activity since yesterday.", to: { session: "ses_brief" } },
      nextDueAt: now + 86_400_000,
    },
    {
      ...base,
      id: "aut_smoke",
      name: "Nightly smoke test",
      trigger: { type: "cron", cron: "0 2 * * *" },
      action: { type: "shell", command: "bun run test:smoke --reporter=dot" },
      nextDueAt: now + 2 * 86_400_000,
      lastRunAt: now,
      lastOutcome: "fired",
      lastOutput: "Exit code: 0\n42 pass, 0 fail",
    },
    {
      ...base,
      id: "aut_docs",
      name: "Documentation review",
      status: "paused",
      trigger: { type: "every", every: "1 day" },
      action: { type: "prompt", prompt: "Review the documentation changes.", to: { subagent: "reviewer" } },
    },
  ]

  await mockWorkspace(page, {
    name: "Atlas",
    directory,
    project: { name: "Atlas (sample)" },
    hostname: "release-runner-03",
    commands: [{ name: "automation" }],
    sessions: [
      { id: "ses_release", title: "Release planning" },
      { id: "ses_brief", title: "Release notes" },
    ],
    automations,
    seed: {
      theme: { id: "oc-2", scheme: "dark" },
      settings: { general: { automations: true }, appearance: { tabLayout: "vertical", sidebarOpen: true } },
    },
  })
  await page.goto(sessionHref("ses_release"))
  const nav = page.getByRole("button", { name: "Automations", exact: true })
  await nav.click()
  await expect(page.getByRole("button", { name: /Morning release brief/ })).toContainText("Weekdays at 9:00 AM")
  const detail = page.getByRole("article")
  await page.getByRole("button", { name: /Release health watch/ }).click()
  await expect(detail.getByRole("heading", { name: "Release health watch" })).toBeVisible()
  await expect(detail.getByText("deployment.finished from deployments", { exact: true })).toBeVisible()
  await expect(
    detail
      .getByRole("term")
      .filter({ hasText: /^Runs on$/ })
      .locator("+ dd"),
  ).toHaveText("release-runner-03")
  await expect(detail.getByText('environment = "staging"', { exact: true })).toBeVisible()
  await expect(detail.getByText("Next run")).toHaveCount(0)
  await expect(
    detail.getByText("Wakes the creating session only when the code returns send", { exact: false }),
  ).toBeVisible()
  await expect(detail.getByText(`${directory}/release`, { exact: true })).toBeVisible()
  await expect(detail.getByText("Deployment status: succeeded", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("automation-inspector.png"), animations: "disabled" })
  await detail.getByRole("button", { name: "Pause", exact: true }).click()
  await expect(nav).toContainText("2")
  await detail.getByRole("button", { name: "Resume", exact: true }).click()
  await expect(nav).toContainText("3")
  await detail.getByRole("button", { name: "Delete", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("button", { name: /Release health watch/ })).toHaveCount(0)
  await expect(detail.getByText("Next run")).toBeVisible()
  await expect(detail.getByRole("button", { name: "Release planning" })).toBeVisible()
  await expect(detail.getByRole("button", { name: "Release notes" })).toBeVisible()
  await page.getByRole("button", { name: /Nightly smoke test/ }).click()
  await expect(detail.getByText("bun run test:smoke --reporter=dot", { exact: true })).toBeVisible()
  await expect(detail.getByText("Doesn’t wake a session", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: /Documentation review/ }).click()
  await expect(detail.getByText("Send a prompt to a new reviewer subagent")).toBeVisible()
  await page.getByRole("button", { name: "New automation" }).click()
  await expect(page.locator('[data-component="composer-editor"]')).toHaveText(/\/automation/)
})

test("hides every automation entry point while the experimental setting is off", async ({ page }) => {
  await mockWorkspace(page, { name: "Off", commands: [{ name: "automation" }] })
  await page.goto("/automations")
  await expect(page.getByText("Automations aren’t available in your open projects.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Automations", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New automation" })).toHaveCount(0)
})

test("discovers an enabled empty project and withdraws the entry when the server removes its command", async ({
  page,
}) => {
  let enabled = true

  const { push, directory } = await mockWorkspace(page, {
    name: "Empty",
    commands: () => (enabled ? [{ name: "automation" }] : []),
    seed: { settings: { general: { automations: true } } },
  })

  await page.goto("/automations")
  await expect(page.getByRole("heading", { name: "No automations yet" })).toBeVisible()
  enabled = false
  await push([
    { id: "evt_automation_disabled", created: 1, type: "command.updated", location: { directory }, data: {} },
  ])
  await expect(page.getByText("Automations aren’t available in your open projects.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Automations", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New automation" })).toHaveCount(0)
})

test("manages a watch outside open locations and opens the recipient instead of its last viewed child", async ({
  page,
}) => {
  const directory = "/projects/repo"
  const docs = `${directory}/docs`
  await mockWorkspace(page, {
    name: "Repo",
    directory,
    commands: [{ name: "automation" }],
    automations: [
      {
        id: "aut_docs",
        projectID: "proj_repo",
        directory: docs,
        name: "Review docs",
        tz: "UTC",
        trigger: { type: "every", every: "1 day" },
        action: { type: "prompt", prompt: "Review new documentation.", to: { session: "ses_parent" } },
        status: "active",
        runCount: 0,
        time: { created: 1, updated: 1 },
      },
    ],
    sessions: [
      { id: "ses_parent", title: "Docs planning" },
      { id: "ses_child", title: "Research notes", parentID: "ses_parent" },
    ],
    seed: {
      settings: { general: { automations: true } },
      storage: {
        "opencode.window.browser.dat:tabs": [
          {
            type: "session",
            sessionId: "ses_parent",
            server: SERVER,
            routeSessionId: "ses_child",
            routeParentId: "ses_parent",
          },
        ],
      },
    },
  })
  await page.goto(sessionHref("ses_child"))
  await expect(page.getByRole("heading", { name: "Research notes", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Automations", exact: true }).click()
  const detail = page.getByRole("article")
  await expect(detail.getByRole("heading", { name: "Review docs" })).toBeVisible()
  await expect(detail.getByText(docs, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New automation" })).toBeVisible()
  await detail.getByRole("button", { name: /Docs planning|ses_parent/ }).click()
  await expect(page).toHaveURL(sessionHref("ses_parent"))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
})

test("keeps identically keyed automations on separate servers and starts the draft in the row’s saved directory", async ({
  page,
}) => {
  const servers = [SERVER, REMOTE_SERVER] as const
  const creates: unknown[] = []
  const commands: unknown[] = []
  await mockServers(
    page,
    Object.fromEntries(
      servers.map((server) => {
        const name = server === SERVER ? "Local" : "Remote"
        const directory = `/projects/${name.toLowerCase()}`

        const row: AutomationInfo = {
          id: "aut_brief",
          name: `${name} brief`,
          projectID: "proj_shared",
          directory: `${directory}/worktrees/docs`,
          status: "active",
          runCount: 0,
          trigger: { type: "at", at: "2027-01-04T09:00" },
          tz: "UTC",
          action: { type: "prompt", prompt: "Review the release notes.", to: { session: "ses_notes" } },
          time: { created: 1, updated: 1 },
        }

        return [
          server,
          {
            directory,
            project: project({ id: row.projectID, directory, name: `${name} project` }),
            provider: provider(),
            pageMessages: () => ({ items: [] }),
            onSessionCreate: (body: { location?: unknown }) => void creates.push({ server, location: body.location }),
            onCommand: (input: { body: unknown }) => void commands.push({ server, body: input.body }),
            sessions: [],
            commands: [{ name: "automation" }],
            automations: [row],
          },
        ]
      }),
    ),
  )
  await seed(page, {
    settings: { general: { automations: true } },
    servers: [REMOTE_SERVER],
    usedProjects: { local: ["proj_shared"], [REMOTE_SERVER]: ["proj_shared"] },
  })
  await page.goto("/automations")
  await page.getByRole("button", { name: /Remote brief/ }).click()
  const detail = page.getByRole("article")
  await expect(detail.getByText("Remote project", { exact: true })).toBeVisible()
  await expect(detail.getByText("Created by")).toHaveCount(0)
  await expect(detail.getByRole("button", { name: "ses_notes" })).toBeVisible()
  const directory = "/projects/remote/worktrees/docs"
  await expect(detail.getByText(directory, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New automation" }).click()
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toHaveText(/\/automation/)
  await editor.fill("/automation Review the release notes on Friday")
  await editor.press("Enter")
  await expect.poll(() => creates).toEqual([{ server: REMOTE_SERVER, location: { directory } }])
  await expect
    .poll(() => commands)
    .toMatchObject([
      { server: REMOTE_SERVER, body: { name: "automation", text: "Review the release notes on Friday" } },
    ])
})
