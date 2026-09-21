import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/MultiProject"
const projectID = "proj_multi_project"
const sessionID = "ses_multi_project"
const title = "Multi-project changes"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("groups last-turn changes by nested project", async ({ page }) => {
  const queries = await setup(page, true)

  const panel = await openLastTurn(page)
  const workspace = panel.getByRole("region", { name: "Workspace" })
  const api = panel.getByRole("region", { name: "api" })
  const payments = panel.getByRole("region", { name: "services/payments" })

  await expect(workspace.getByRole("button", { name: "README.md" })).toBeVisible()
  await expect(api.getByRole("button", { name: "file-0.ts" })).toBeVisible()
  await api.getByRole("button", { name: "src" }).click()
  await expect(api.getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "false")
  await payments.evaluate((section) => {
    const scroll = section.closest<HTMLElement>(".scroll-view__viewport")
    if (!scroll) throw new Error("Missing review scroll viewport")
    scroll.scrollTop = section.offsetTop
  })
  await expect(payments.getByRole("button", { name: "file-0.ts" })).toBeVisible()
  await payments.evaluate((section) => {
    const scroll = section.closest<HTMLElement>(".scroll-view__viewport")
    if (!scroll) throw new Error("Missing review scroll viewport")
    scroll.scrollTop = section.offsetTop + 1_500
  })
  await expect(payments.getByRole("button", { name: "file-50.ts" })).toBeVisible()
  const scroll = panel.getByRole("region", { name: "scrollable content" })
  await scroll.hover()
  await page.mouse.wheel(0, 10_000)
  await payments.getByRole("button", { name: "z-last.ts" }).click()
  await expect(payments.getByRole("button", { name: "z-last.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("services/payments/src/", { exact: true })).toBeVisible()
  expect(queries).toEqual([`${directory}/api/src`, `${directory}/services/payments/src`])

  await page.getByRole("button", { name: "Last turn changes" }).click()
  await page.getByRole("option", { name: "Git changes" }).click()
  await expect(panel.locator('[data-component="session-review-project-groups"]')).toHaveCount(0)
  await expect(panel.locator('[data-component="file-tree-v2"]')).toHaveCount(1)
})

test("keeps one file tree when top-level directories belong to the session project", async ({ page }) => {
  await setup(page, false)

  const panel = await openLastTurn(page)
  await expect(panel.getByRole("region", { name: "packages" })).toHaveCount(0)
  await expect(panel.locator('[data-component="file-tree-v2"]')).toHaveAttribute("data-total-rows", "7")
})

async function setup(page: Page, nested: boolean) {
  const queries: string[] = []
  const files = nested
    ? [
        "README.md",
        "api/src/index.ts",
        ...Array.from({ length: 100 }, (_, index) => `api/src/file-${index}.ts`),
        ...Array.from({ length: 100 }, (_, index) => `services/payments/src/file-${index}.ts`),
        "services/payments/src/z-last.ts",
      ]
    : ["packages/app/src/index.ts", "packages/ui/src/index.ts"]
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: project(projectID, directory, "Workspace"),
    projectForDirectory: (path) => {
      if (path !== directory) queries.push(path)
      if (nested && path.startsWith(`${directory}/api`)) return project("proj_api", `${directory}/api`, "API")
      if (nested && path.startsWith(`${directory}/services/payments`))
        return project("proj_payments", `${directory}/services/payments`, "Payments")
      return project(projectID, directory, "Workspace")
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: messages(files) }),
    vcsDiff: files.map(diff),
  })
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID },
  )
  return queries
}

async function openLastTurn(page: Page) {
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await page.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Last turn" }).click()
  return page.locator("#review-panel")
}

function project(id: string, worktree: string, name: string) {
  return {
    id,
    worktree,
    vcs: "git",
    name,
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function messages(files: string[]) {
  const userID = "msg_multi_project_user"
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 1700000000000 },
        summary: {
          diffs: files.map(diff),
        },
        agent: "build",
        model: { providerID: "opencode", modelID: "test" },
      },
      parts: [
        {
          id: "prt_multi_project_user",
          sessionID,
          messageID: userID,
          type: "text",
          text: "Update each project.",
        },
      ],
    },
    {
      info: {
        id: "msg_multi_project_assistant",
        sessionID,
        role: "assistant",
        time: { created: 1700000001000 },
        parentID: userID,
        modelID: "test",
        providerID: "opencode",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    },
  ]
}

function diff(file: string) {
  return {
    file,
    additions: 1,
    deletions: 1,
    status: "modified",
    patch: `@@ -1 +1 @@\n-before\n+after`,
  }
}
