import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, contextOptions: { reducedMotion: "reduce" } })

    test("project list actions and edges stay inside the settings scrollport", async ({ page }, info) => {
      const projects = ["rebase", "dinocms", "opencode", "Playground"].map((name, index) => ({
        id: `project-${index}`,
        name,
        canonical: `/projects/${name}`,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }))
      await mockOpenCodeServer(page, {
        directory: "/projects/rebase",
        project: projects[0],
        sessions: [],
        pageMessages: () => ({ items: [] }),
        provider: { all: [], connected: [], default: {} },
        fileList: () => [],
      })
      await page.route("**/api/project", (route) =>
        route.fulfill({ json: projects, headers: { "access-control-allow-origin": "*" } }),
      )
      await page.route("**/api/project/project-0", async (route) => {
        const update = route.request().postDataJSON()
        await route.fulfill({
          json: { ...projects[0], ...update },
          headers: { "access-control-allow-origin": "*" },
        })
      })
      await page.addInitScript((projects) => {
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
      const settings = page.getByTestId("settings-screen")
      await settings.getByRole("tab", { name: "Projects", exact: true }).click()
      const panel = settings.getByRole("tabpanel")
      await expect(panel.getByText("rebase", { exact: true })).toBeVisible()
      await expect(panel.getByText("Playground", { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Add project", exact: true })).toBeVisible()
      const list = panel.getByRole("list")
      await expect(list.getByRole("listitem")).toHaveCount(4)
      const projectButton = panel.getByRole("button", { name: "rebase", exact: true })
      const projectCard = list.getByRole("listitem").filter({ hasText: "rebase" })
      const projectName = projectButton.getByText("rebase", { exact: true })
      await expect(projectName).toHaveCSS("font-weight", "530")
      await expect(projectName).toHaveCSS("line-height", "20px")
      await expect(projectButton.getByText("/projects/rebase", { exact: true })).toHaveCount(0)
      await expect
        .poll(() =>
          list.evaluate((group) => {
            const icons = Array.from(group.querySelectorAll('[data-component="project-avatar-v2"]'))
            const first = icons.at(0)?.getBoundingClientRect()
            const last = icons.at(-1)?.getBoundingClientRect()
            const bounds = group.getBoundingClientRect()
            if (!first || !last) return []
            return [first.top - bounds.top, bounds.bottom - last.bottom, first.left - bounds.left]
          }),
        )
        .toEqual([16, 16, 16])
      await expect
        .poll(() =>
          list
            .locator(".settings-project-row-shell")
            .filter({ hasText: "rebase" })
            .evaluate((row) => {
              const group = row.parentElement
              if (!group) return 0
              return (
                row.getBoundingClientRect().left -
                group.getBoundingClientRect().left +
                Number.parseFloat(getComputedStyle(row, "::after").insetInlineStart)
              )
            }),
        )
        .toBe(16)
      const chevron = projectButton.locator('svg:has(use[href="#opencode-v2-icon-chevron-right"])')
      await expect(chevron).toHaveCount(0)
      const hoverColor = await projectCard.evaluate((element) => {
        const probe = document.createElement("div")
        probe.style.backgroundColor = "var(--v2-background-bg-layer-02)"
        element.append(probe)
        const color = getComputedStyle(probe).backgroundColor
        probe.remove()
        return color
      })
      await projectCard.hover()
      await expect(projectCard).toHaveCSS("background-color", hoverColor)
      const more = projectCard.getByRole("button", { name: "More options", exact: true })
      await more.click()
      const menu = page.getByRole("menu")
      await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Clear notifications", "Close"])
      await menu.getByRole("menuitem", { name: "Close", exact: true }).hover()
      await expect(projectCard).toHaveCSS("background-color", hoverColor)
      await expect(menu.getByRole("separator")).toHaveCount(1)
      await menu.getByRole("menuitem", { name: "Edit", exact: true }).click()
      await expect(panel.getByRole("heading", { name: "rebase", exact: true })).toBeVisible()
      await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
      await expect(panel.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      for (const width of [1280, 1050, 960, 720, 600]) {
        await page.setViewportSize({ width, height: 720 })
        await page.mouse.move(0, 0)
        await page.screenshot({ path: info.outputPath(`projects-${width}.png`), animations: "disabled" })
        // Each project card stays fully inside every horizontal clip ancestor.
        await expect
          .poll(() =>
            projectCard.evaluate((row) => {
              const bounds = row.getBoundingClientRect()
              const clips = []
              for (let parent = row.parentElement; parent; parent = parent.parentElement) {
                if (getComputedStyle(parent).overflowX === "visible") continue
                const clip = parent.getBoundingClientRect()
                clips.push(bounds.left - clip.left, clip.right - bounds.right)
              }
              return Math.min(...clips)
            }),
          )
          .toBeGreaterThanOrEqual(4)
        await expect(panel).toHaveJSProperty("scrollWidth", await panel.evaluate((el) => el.clientWidth))
      }

      await page.setViewportSize({ width: 1280, height: 720 })
      await panel.getByText("rebase", { exact: true }).hover()
      await panel.getByText("rebase", { exact: true }).click()
      await expect(settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("rebase")
      await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
      await expect(panel.getByText("rebase", { exact: true })).toBeVisible()

      const secondProject = panel.getByRole("button", { name: "dinocms", exact: true })
      await list
        .getByRole("listitem")
        .filter({ hasText: "dinocms" })
        .getByRole("button", { name: "More options", exact: true })
        .click()
      await page.getByRole("menuitem", { name: "Close", exact: true }).click()
      await expect(secondProject).toHaveCount(0)

      await page.setViewportSize({ width: 1280, height: 260 })
      await panel.getByText("rebase", { exact: true }).hover()
      await page.mouse.wheel(0, 400)
      await expect(panel.getByText("Playground", { exact: true })).toBeInViewport({ ratio: 1 })
      await expect(panel.getByRole("heading", { name: "Projects", exact: true })).toBeInViewport({ ratio: 1 })

      await page.setViewportSize({ width: 1280, height: 720 })
      await more.click()
      await menu.getByRole("menuitem", { name: "Rename", exact: true }).click()
      const rename = panel.getByRole("textbox", { name: "Rename", exact: true })
      await expect(rename).toBeFocused()
      await expect(rename).toHaveValue("rebase")
      await expect(rename).toHaveCSS("border-radius", "0px")
      await rename.fill("Renamed project")
      const renamed = page.waitForRequest(
        (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/project/project-0",
      )
      await rename.press("Enter")
      expect((await renamed).postDataJSON()).toEqual({ name: "Renamed project" })
      await expect(panel.getByRole("button", { name: "Renamed project", exact: true })).toBeVisible()

      await panel.getByRole("button", { name: "Add project", exact: true }).click()
      const picker = page.getByRole("dialog", { name: "Open project", exact: true })
      await picker.getByRole("combobox").fill("/projects/added")
      await picker.getByRole("combobox").press("Enter")
      const selectFolder = picker.getByRole("button", { name: "Select folder", exact: true })
      await expect(selectFolder).toBeEnabled()
      await selectFolder.click()
      await expect(picker).toBeHidden()
      await expect(panel.getByRole("heading", { name: "added", exact: true })).toBeVisible()
    })
  })
}
