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
      })
      await page.route("**/api/project", (route) =>
        route.fulfill({ json: projects, headers: { "access-control-allow-origin": "*" } }),
      )
      const stale = "/projects/missing-project"
      await page.route("**/api/project/check", (route) => {
        const directories = (route.request().postDataJSON() as { directories: string[] }).directories
        return route.fulfill({ json: { directories: directories.filter((directory) => directory !== stale) } })
      })
      await page.addInitScript(({ projects, stale }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: projects.map((project) => ({ worktree: project.canonical, expanded: true })) },
          }),
        )
        localStorage.setItem(
          "opencode.global.dat:layout",
          JSON.stringify({ home: { selection: { server: "local", directory: stale } } }),
        )
      }, { projects: [...projects, { canonical: stale }], stale })
      await page.goto("/")
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("opencode.global.dat:layout") ?? "{}").home?.selection?.directory,
          ),
        )
        .toBeUndefined()
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeEnabled()
      await page.getByRole("button", { name: "Settings", exact: true }).click()
      const settings = page.getByTestId("settings-screen")
      await settings.getByRole("tab", { name: "Projects", exact: true }).click()
      const panel = settings.getByRole("tabpanel")
      await expect(panel.getByText("rebase", { exact: true })).toBeVisible()
      await expect(panel.getByText("Playground", { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "missing-project", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Add project", exact: true })).toBeVisible()
      const list = panel.locator('[data-component="settings-list"]')
      await expect(list).toHaveAttribute("data-variant", "catalog")
      await expect(list).toHaveCSS("padding-left", "16px")
      await expect(list).toHaveCSS("padding-right", "16px")
      const projectButton = panel.getByRole("button", { name: "rebase", exact: true })
      const projectRow = projectButton.locator("..")
      const projectName = projectButton.getByText("rebase", { exact: true })
      await expect(projectName).toHaveCSS("font-weight", "530")
      await expect(projectName).toHaveCSS("line-height", "20px")
      await expect(projectRow).toHaveCSS("padding-top", "16px")
      await expect(projectRow).toHaveCSS("padding-bottom", "16px")
      expect(
        Math.abs(
          (await projectButton.evaluate((element) => element.getBoundingClientRect().height)) -
            (await projectRow.evaluate((element) => element.getBoundingClientRect().height)),
        ),
      ).toBeLessThanOrEqual(1)
      const chevron = projectButton.locator('svg:has(use[href="#opencode-v2-icon-chevron-right"])')
      await expect(chevron).toHaveCSS("opacity", "0")
      await projectRow.hover()
      await expect(chevron).toHaveCSS("opacity", "1")
      const more = projectRow.getByRole("button", { name: "More options", exact: true })
      await more.click()
      const menu = page.getByRole("menu")
      await expect(menu.getByRole("menuitem")).toHaveText(["New session", "Clear notifications", "Close"])
      await expect(menu.getByRole("separator")).toHaveCount(1)
      await panel.getByRole("heading", { name: "Projects", exact: true }).click()
      await expect(menu).toBeHidden()
      await page.evaluate(() => document.fonts.ready)

      for (const width of [1280, 1050, 960, 720, 600]) {
        await page.setViewportSize({ width, height: 720 })
        await page.mouse.move(0, 0)
        await page.screenshot({ path: info.outputPath(`projects-${width}.png`), animations: "disabled" })
        // The catalog card and its rows stay fully inside every horizontal clip ancestor.
        await expect
          .poll(() =>
            projectRow.evaluate((row) => {
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
      await secondProject.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menuitem", { name: "Close", exact: true }).click()
      await expect(secondProject).toHaveCount(0)

      await page.setViewportSize({ width: 1280, height: 260 })
      await panel.getByText("rebase", { exact: true }).hover()
      await page.mouse.wheel(0, 400)
      await expect(panel.getByText("Playground", { exact: true })).toBeInViewport({ ratio: 1 })
      await expect(panel.getByRole("heading", { name: "Projects", exact: true })).toBeInViewport({ ratio: 1 })
    })
  })
}
