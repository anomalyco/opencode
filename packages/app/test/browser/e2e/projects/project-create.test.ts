import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"

describe("project create", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("new project appears in sidebar and is selected", async () => {
    await app.page.goto(`${app.origin}/`)

    const name = `E2E Project ${Date.now()}`
    const created = app.page.waitForResponse(
      (response) => response.url().endsWith("/project/create") && response.request().method() === "POST",
    )

    await app.page.locator('[data-component="sidebar-rail"]').getByRole("button", { name: "New project" }).click()
    const dialog = app.page.getByRole("dialog").filter({ hasText: "Create a new project" })
    await dialog.waitFor({ state: "visible" })
    await dialog.getByLabel("Project name").fill(name)
    await dialog.getByRole("button", { name: "Create project" }).click()

    const res = await created
    const payload = (await res.json()) as { project?: { id?: string } }
    const projectID = payload.project?.id
    expect(projectID).toBeTruthy()

    await expect
      .poll(() => app.page.url(), { timeout: 30_000 })
      .toMatch(new RegExp(`/${projectID}/session(?:[/?#]|$)`))

    const tile = app.page.locator(`[data-action="project-switch"][data-project="${projectID}"]`)
    await tile.waitFor({ state: "visible" })
    expect(await tile.getAttribute("aria-label")).toBe(name)
    expect(await tile.getAttribute("aria-current")).toBe("page")
  })
})
