import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.beforeEach(async ({ page }) => {
  const sessions = fixture.sessions.map((session) => ({ ...session }))
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.route(/\/session\/[^/]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const id = new URL(route.request().url()).pathname.split("/").at(-1)
    const session = sessions.find((item) => item.id === id)
    const payload: unknown = route.request().postDataJSON()
    if (
      !session ||
      !payload ||
      typeof payload !== "object" ||
      !("title" in payload) ||
      typeof payload.title !== "string"
    )
      throw new Error("Invalid rename request")
    session.title = payload.title
    await route.fulfill({ json: session, headers: { "access-control-allow-origin": "*" } })
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)
  await page.goto("/")
  await page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle }).click()
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
})

for (const commit of ["Enter", "blur", "click outside"]) {
  test(`saves the session heading on ${commit}`, async ({ page }) => {
    await page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).click()
    const input = page.locator('input[data-slot="session-title-child"]')
    await expect(input).toBeFocused()
    await input.fill("Renamed session")
    if (commit === "Enter") await input.press("Enter")
    if (commit === "blur") await input.press("Tab")
    if (commit === "click outside") await page.getByRole("textbox", { name: "Prompt", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Renamed session", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-history-row"]').filter({ hasText: "Renamed session" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { name: "Renamed session", exact: true })).toBeVisible()
  })
}

test("cancels the session heading with Escape", async ({ page }) => {
  await page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).click()
  const input = page.locator('input[data-slot="session-title-child"]')
  await input.fill("Discard this title")
  await input.press("Escape")
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
})

test("keeps the draft when saving the session heading fails", async ({ page }) => {
  await page.route(/\/session\/[^/]+(?:\?.*)?$/, (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } })
  })
  await page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).click()
  const input = page.locator('input[data-slot="session-title-child"]')
  await input.fill("Retry this title")
  await input.press("Tab")
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue("Retry this title")
  await expect(
    page.locator('[data-component="session-history-row"]').filter({ hasText: fixture.expected.targetTitle }),
  ).toBeVisible()
})

test("does not save an empty session heading", async ({ page }) => {
  await page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).click()
  const input = page.locator('input[data-slot="session-title-child"]')
  await input.fill("   ")
  await input.press("Tab")
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
})
