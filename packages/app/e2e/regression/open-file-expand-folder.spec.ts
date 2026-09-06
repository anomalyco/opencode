import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/OpenFileExpand"
const projectID = "proj_open_file_expand"
const sessionID = "ses_open_file_expand"
const title = "Open file expand"
const longFilename = "a-very-long-file-name-that-must-overflow-the-file-sidebar-instead-of-being-truncated.ts"
const longPath = `frontend/${longFilename}`
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("expands Windows paths and horizontally scrolls long filenames", async ({ page }) => {
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
    vcsDiff: [
      {
        file: longPath,
        before: "",
        after: "export const added = true\n",
        additions: 1,
        deletions: 0,
        status: "added",
        patch: "@@ -0,0 +1 @@\n+export const added = true\n",
      },
    ],
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
          {
            name: longFilename,
            path: `frontend\\${longFilename}`,
            absolute: `${directory}/${longPath}`,
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
    findFiles: ({ query }) => (longPath.includes(query) ? [longPath] : []),
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

  const viewport = sidebar.locator('[data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  const longRow = panel.getByRole("button", { name: longFilename })
  await expect(longRow).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  expect(
    await longRow.evaluate((element) => getComputedStyle(element.querySelector("bdi")!.parentElement!).textOverflow),
  ).toBe("clip")
  expect(await longRow.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(
    await viewport.evaluate((element) => element.clientWidth),
  )
  await expect
    .poll(() =>
      panel.locator('[data-slot="file-tree-v2-row"]').evaluateAll((rows) => {
        const widths = rows.map((row) => row.getBoundingClientRect().width)
        return Math.max(...widths) - Math.min(...widths)
      }),
    )
    .toBeLessThanOrEqual(0.5)
  await expect(longRow.locator('[data-slot="file-tree-v2-label"]')).toHaveCSS("margin-inline-end", "12px")
  const status = longRow.locator('[data-slot="file-tree-v2-change"]')
  await expect(status).toHaveText("A")
  const statusBox = await status.boundingBox()
  if (!statusBox) throw new Error("File status has no bounding box")
  const viewportBox = await viewport.boundingBox()
  if (!viewportBox) throw new Error("File tree viewport has no bounding box")
  expect(viewportBox.x + viewportBox.width - statusBox.x - statusBox.width).toBeLessThanOrEqual(24)

  await viewport.hover()
  const horizontalThumb = sidebar.locator('.scroll-view__thumb[data-orientation="horizontal"]')
  await expect(horizontalThumb).toHaveCSS("opacity", "1")
  await page.mouse.wheel(1_000, 0)
  await expect.poll(() => viewport.evaluate((element) => Math.abs(element.scrollLeft))).toBeGreaterThan(0)
  await expect(horizontalThumb).toHaveAttribute("data-visible", "true")
  await expect
    .poll(() =>
      status.evaluate((element) => {
        const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect()
        return viewport.right - element.getBoundingClientRect().right
      }),
    )
    .toBeLessThanOrEqual(24)

  const beforeDrag = await viewport.evaluate((element) => Math.abs(element.scrollLeft))
  const thumbBox = await horizontalThumb.boundingBox()
  if (!thumbBox) throw new Error("Horizontal scrollbar thumb has no bounding box")
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumbBox.x + thumbBox.width / 2 - 40, thumbBox.y + thumbBox.height / 2)
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((element) => Math.abs(element.scrollLeft))).toBeLessThan(beforeDrag)

  const filter = panel.getByRole("combobox", { name: "Filter files" })
  await filter.fill(longFilename)
  const filteredRow = panel.getByRole("option", { name: longFilename })
  await expect(filteredRow).toBeVisible()
  const filteredStatus = filteredRow.locator('[data-slot="file-tree-v2-change"]')
  await expect(filteredStatus).toHaveText("A")
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)

  await viewport.evaluate((element) => {
    element.setAttribute("dir", "rtl")
    element.scrollLeft = 0
    element.dispatchEvent(new Event("scroll"))
  })
  await expect
    .poll(() =>
      filteredStatus.evaluate((element) => {
        const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!.getBoundingClientRect()
        return element.getBoundingClientRect().left - viewport.left
      }),
    )
    .toBeLessThanOrEqual(24)
  const rtlThumbBox = await horizontalThumb.boundingBox()
  if (!rtlThumbBox) throw new Error("RTL horizontal scrollbar thumb has no bounding box")
  await page.mouse.move(rtlThumbBox.x + rtlThumbBox.width / 2, rtlThumbBox.y + rtlThumbBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rtlThumbBox.x + rtlThumbBox.width / 2 - 40, rtlThumbBox.y + rtlThumbBox.height / 2)
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(0)
  await viewport.evaluate((element) => {
    element.removeAttribute("dir")
    element.scrollLeft = 0
    element.dispatchEvent(new Event("scroll"))
  })

  await filter.fill("")

  const appRow = panel.locator('[data-slot="file-tree-v2-row"][data-path="frontend/app.ts"]')
  await expect(appRow).toBeVisible()
  await appRow.click()
  await expect(panel.getByRole("tab", { name: "app.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:frontend/app.ts", { exact: true })).toBeVisible()
})
