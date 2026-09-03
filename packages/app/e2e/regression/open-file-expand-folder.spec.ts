import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/OpenFileExpand"
const projectID = "proj_open_file_expand"
const sessionID = "ses_open_file_expand"
const title = "Open file expand"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("expands a folder whose path has a trailing Windows separator", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "open-file-expand",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
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
    vcsDiff: [],
    fileList: (path) => {
      if (path === "frontend\\" || path === "frontend") {
        return [
          {
            name: "app.ts",
            path: "frontend\\app.ts",
            absolute: `${directory}/frontend/app.ts`,
            type: "file" as const,
            ignored: false,
          },
        ]
      }
      if (path) return []
      return [
        {
          name: "",
          path: "frontend\\",
          absolute: `${directory}/frontend`,
          type: "directory" as const,
          ignored: false,
        },
        {
          name: "README.md",
          path: "README.md",
          absolute: `${directory}/README.md`,
          type: "file" as const,
          ignored: false,
        },
      ]
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    pageMessages: () => ({ items: [] }),
  })

  await page.addInitScript(
    ({ directory, server, sessionID, tabKey }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ review: { diffStyle: "split" } }))
      localStorage.setItem("opencode.window.browser.dat:tabs.panes", JSON.stringify({ [tabKey]: { review: true } }))
      localStorage.setItem(
        "opencode.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: true, sidebarWidth: 240, expandMode: "collapse" }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID, tabKey: `${server}\n/server/${base64Encode(server)}/session/${sessionID}` },
  )

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")

  const sidebar = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  await expect(sidebar).toBeVisible()

  const frontendRow = panel.locator('[data-slot="file-tree-v2-row"][data-path="frontend"]')
  await expect(frontendRow).toBeVisible()
  await expect(frontendRow.getByText("frontend", { exact: true })).toBeVisible()
  await expect(frontendRow).toHaveAttribute("aria-expanded", "false")
  await frontendRow.click()
  await expect(frontendRow).toHaveAttribute("aria-expanded", "true")

  const appRow = panel.locator('[data-slot="file-tree-v2-row"][data-path="frontend/app.ts"]')
  await expect(appRow).toBeVisible()
  await appRow.click()
  await expect(panel.getByRole("tab", { name: "app.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:frontend/app.ts", { exact: true })).toBeVisible()
})
