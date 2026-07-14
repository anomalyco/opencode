import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/FileBrowserSidebar"
const projectID = "proj_file_browser_sidebar"
const sessionID = "ses_file_browser_sidebar"
const title = "File browser sidebar"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const files = Array.from({ length: 80 }, (_, index) => `file-${String(index).padStart(2, "0")}.ts`)
// Marks the file-browser sidebar DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// The file-browser sidebar must stay mounted across preview/pinned file-tab
// switches. Remounting resets scroll and filter state.
test("keeps the file-browser sidebar mounted when switching file tabs", async ({ page }) => {
  await setup(page)

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")

  const sidebar = panel.locator('[data-component="session-review-v2-sidebar-root"]')
  await expect(sidebar).toBeVisible()
  await expect(panel.getByRole("button", { name: "file-00.ts" })).toBeVisible()

  await panel.getByRole("button", { name: "file-00.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-00.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:file-00.ts", { exact: true })).toBeVisible()

  const viewport = panel.locator('[data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const scrolled = await viewport.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await writeProbe(page)

  await panel.getByRole("button", { name: "file-79.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-79.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:file-79.ts", { exact: true })).toBeVisible()
  expect(await readProbe(page)).toBe(PROBE)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)

  await panel.getByRole("button", { name: "file-78.ts" }).dblclick()
  await expect(panel.getByRole("tab", { name: "file-78.ts" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("button", { name: "file-79.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-79.ts" })).toHaveAttribute("data-selected", "")
  await panel.getByRole("tab", { name: "file-78.ts" }).click()
  await expect(panel.getByRole("tab", { name: "file-78.ts" })).toHaveAttribute("data-selected", "")
  expect(await readProbe(page)).toBe(PROBE)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(scrolled)
})

type Probed = HTMLElement & { __e2eProbe?: string }

async function writeProbe(page: Page) {
  await page.locator('#review-panel [data-component="session-review-v2-sidebar-root"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page
    .locator('#review-panel [data-component="session-review-v2-sidebar-root"]')
    .evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "file-browser-sidebar",
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
      if (path) return []
      return files.map((name) => ({
        name,
        path: name,
        absolute: `${directory}/${name}`,
        type: "file" as const,
        ignored: false,
      }))
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    pageMessages: () => ({ items: [] }),
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
        "opencode.global.dat:layout",
        JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
      )
      localStorage.setItem(
        "opencode.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: true, sidebarWidth: 240, expandMode: "collapse" }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID },
  )
}
