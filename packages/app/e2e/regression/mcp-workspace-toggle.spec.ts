import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:\\OpenCode\\main"
const workspace = "C:\\OpenCode\\worktree"
const projectID = "proj_mcp_workspace"
const sessionID = "ses_mcp_workspace"
const title = "Workspace MCP routing"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

for (const shared of [true, false]) {
  test(`toggles the workspace MCP when the default location ${shared ? "has" : "does not have"} the server`, async ({
    page,
  }, testInfo) => {
    const connected = new Set<string>()
    const requests: { path: string; directory: string }[] = []
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "mcp-workspace",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [workspace],
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [{ id: sessionID, projectID, directory: workspace, title }],
      pageMessages: () => ({ items: [] }),
    })
    await page.route("**/api/mcp**", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()
      const url = new URL(route.request().url())
      const target = url.searchParams.get("location[directory]") ?? directory
      requests.push({ path: url.pathname, directory: target })
      if (url.pathname === "/api/mcp/figma-desktop/connect") {
        connected.add(target)
        return route.fulfill({ status: 204 })
      }
      if (url.pathname === "/api/mcp/figma-desktop/disconnect") {
        connected.delete(target)
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({
        json: {
          location: { directory: target },
          data:
            url.pathname === "/api/mcp/resource"
              ? { resources: [], templates: [] }
              : !shared && target !== workspace
                ? []
                : [{ name: "figma-desktop", status: { status: connected.has(target) ? "connected" : "disabled" } }],
        },
      })
    })

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
    await page.keyboard.press("ControlOrMeta+;")
    const dialog = page.getByRole("dialog", { name: "MCPs", exact: true })
    await expect(dialog.getByText("figma-desktop", { exact: true })).toBeVisible()
    const toggle = dialog.getByRole("switch")
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
    requests.length = 0

    await dialog.locator('[data-slot="switch-control"]').click()
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeEnabled()
    expect(connected).toEqual(new Set([workspace]))
    expect(requests).toContainEqual({ path: "/api/mcp/figma-desktop/connect", directory: workspace })
    expect(requests).toContainEqual({ path: "/api/mcp/resource", directory: workspace })
    expect(requests.every((request) => request.directory === workspace)).toBe(true)
    await testInfo.attach("workspace-connected", { body: await page.screenshot(), contentType: "image/png" })

    requests.length = 0
    await dialog.getByText("figma-desktop", { exact: true }).click()
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
    expect(connected.size).toBe(0)
    expect(requests).toContainEqual({ path: "/api/mcp/figma-desktop/disconnect", directory: workspace })
    expect(requests.every((request) => request.directory === workspace)).toBe(true)
  })
}
