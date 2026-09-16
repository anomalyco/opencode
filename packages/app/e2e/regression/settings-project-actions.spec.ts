import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

test.beforeEach(async ({ page }) => {
  const projects = Array.from({ length: 8 }, (_, index) => ({
    id: index === 1 ? "global" : `project-${index}`,
    name: `Project ${index}`,
    canonical: `/projects/project-${index}`,
    time: { created: 1, updated: 1 },
  }))
  await mockOpenCodeServer(page, {
    directory: projects[0].canonical,
    project: projects[0],
    sessions: [],
    pageMessages: () => ({ items: [] }),
    provider: { all: [], connected: [], default: {} },
  })
  await page.route("**/api/project", (route) =>
    route.fulfill({ json: projects, headers: { "access-control-allow-origin": "*" } }),
  )
  await page.route("**/api/project/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const project = projects.find((item) => route.request().url().endsWith(`/${item.id}`))
    const payload: unknown = route.request().postDataJSON()
    if (
      !project ||
      !payload ||
      typeof payload !== "object" ||
      !("name" in payload) ||
      typeof payload.name !== "string"
    )
      throw new Error("Invalid project rename request")
    project.name = payload.name
    return route.fulfill({ json: project, headers: { "access-control-allow-origin": "*" } })
  })
  await page.addInitScript((projects) => {
    if (localStorage.getItem("opencode.global.dat:server")) return
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: projects.map((project) => ({ worktree: project.canonical, expanded: true })) },
      }),
    )
  }, projects)
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByTestId("settings-screen").getByRole("tab", { name: "Projects", exact: true }).click()
  await expect(page.getByRole("tabpanel").getByRole("button", { name: "Project 0", exact: true })).toBeEnabled()
})

for (const direction of ["ltr", "rtl"]) {
  test(`project context menu renames, cancels and closes in ${direction}`, async ({ page }, info) => {
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    const panel = page.getByRole("tabpanel")
    const project = panel.getByRole("button", { name: "Project 0", exact: true })
    await project.click({ button: "right" })
    await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Close"])
    await page.screenshot({ path: info.outputPath("project-menu.png"), animations: "disabled" })
    await page.keyboard.press("Escape")
    await expect(project).toBeFocused()
    await project.press("Shift+F10")
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const editor = panel.getByRole("textbox", { name: "Rename", exact: true })
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue("Project 0")
    await expect
      .poll(() => editor.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!))
      .toBe(9)
    await editor.fill("Cancelled name")
    await editor.press("Escape")
    await expect(project).toBeFocused()

    await project.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    await expect(editor).toBeFocused()
    await editor.fill("Blurred name")
    await panel.getByRole("searchbox", { name: "Search projects" }).click()
    await expect(project).toBeVisible()
    await expect(editor).toBeHidden()

    await project.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    await expect(editor).toBeFocused()
    await editor.fill("Renamed project")
    await page.screenshot({ path: info.outputPath("project-rename.png"), animations: "disabled" })
    const request = page.waitForRequest(
      (request) => request.method() === "PATCH" && request.url().endsWith("/api/project/project-0"),
    )
    await editor.press("Enter")
    expect((await request).postDataJSON()).toEqual({ name: "Renamed project" })
    const renamed = panel.getByRole("button", { name: "Renamed project", exact: true })
    await expect(renamed).toBeFocused()
    await expect(panel.getByText("/projects/project-0", { exact: true })).toBeVisible()
    await expect(renamed).toHaveCSS("min-height", "73px")

    await renamed.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Close", exact: true }).click()
    await expect(renamed).toBeHidden()
    await expect(panel.getByRole("button", { name: "Project 1", exact: true })).toBeFocused()
    await expect(panel.getByRole("searchbox", { name: "Search projects" })).toBeHidden()
    await page.reload()
    const settings = page.getByTestId("settings-screen")
    await expect(settings.getByRole("tab", { name: "Projects", exact: true })).toBeEnabled()
    await settings.getByRole("tab", { name: "Projects", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Project 1", exact: true })).toBeEnabled()
    await expect(renamed).toBeHidden()
  })
}

test("failed project rename keeps the draft for retry", async ({ page }) => {
  await page.route("**/api/project/project-0", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } })
      : route.fallback(),
  )
  const panel = page.getByRole("tabpanel")
  await panel.getByRole("button", { name: "Project 0", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const editor = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("Retry this project name")
  await editor.press("Enter")
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(editor).toBeEditable()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue("Retry this project name")
  await editor.press("Escape")
  await expect(panel.getByRole("button", { name: "Project 0", exact: true })).toBeFocused()
})

test("non-repository project names update locally", async ({ page }) => {
  const panel = page.getByRole("tabpanel")
  await panel.getByRole("button", { name: "Project 1", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const editor = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("Local project")
  await editor.press("Enter")
  await expect(panel.getByRole("button", { name: "Local project", exact: true })).toBeFocused()
  await expect(panel.getByText("/projects/project-1", { exact: true })).toBeVisible()
})

test("a server-known project can be renamed and closed without first opening it", async ({ page }) => {
  await page.evaluate(() => {
    const stored: { projects: { local: { worktree: string; expanded: boolean }[] } } = JSON.parse(
      localStorage.getItem("opencode.global.dat:server")!,
    )
    stored.projects.local = stored.projects.local.filter((project) => project.worktree !== "/projects/project-1")
    localStorage.setItem("opencode.global.dat:server", JSON.stringify(stored))
  })
  await page.reload()
  const settings = page.getByTestId("settings-screen")
  await expect(settings.getByRole("tab", { name: "Projects", exact: true })).toBeEnabled()
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  const panel = page.getByRole("tabpanel")
  await panel.getByRole("button", { name: "Project 1", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const editor = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("Known local project")
  await editor.press("Enter")
  const renamed = panel.getByRole("button", { name: "Known local project", exact: true })
  await expect(renamed).toBeFocused()
  await renamed.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(renamed).toBeHidden()
  await expect(panel.getByText("/projects/project-1", { exact: true })).toBeHidden()
})
