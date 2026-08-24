import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("renames, exports, and deletes a home session from its context menu", async ({ page }) => {
  const sessions = fixture.sessions.map((session) => ({ ...session }))
  await mockOpenCodeServer(page, {
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.route("**/api/session/*/rename", async (route) => {
    const sessionID = new URL(route.request().url()).pathname.split("/").at(-2)
    const session = sessions.find((item) => item.id === sessionID)
    const payload: unknown = route.request().postDataJSON()
    if (!payload || typeof payload !== "object" || !("title" in payload) || typeof payload.title !== "string")
      throw new Error("Invalid rename payload")
    if (session) session.title = payload.title
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
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
  const row = page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle })
  await expect(row).toBeVisible()
  const container = page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`)
  const titleBox = await container.locator('[data-component="home-session-title"]').boundingBox()
  const avatarBox = await container.locator('[data-component="project-avatar-v2"]').boundingBox()
  await expect(container.getByRole("button", { name: "More options" })).toHaveCount(0)

  await row.focus()
  await row.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden()
  await expect(row).toBeFocused()

  const rowBox = await row.boundingBox()
  await row.click({ button: "right", position: { x: 48, y: 12 } })
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Export..." })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Delete..." })).toBeVisible()
  const menuBox = await page.locator('[data-component="menu-v2-content"]').boundingBox()
  expect(Math.abs((menuBox?.x ?? 0) - (rowBox?.x ?? 0) - 48)).toBeLessThan(4)

  await page.getByRole("menuitem", { name: "Rename" }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue(fixture.expected.targetTitle)
  const editorBox = await title.boundingBox()
  const editingAvatarBox = await container.locator('[data-component="project-avatar-v2"]').boundingBox()
  expect(editorBox?.x).toBe(titleBox?.x)
  expect(editingAvatarBox).toEqual(avatarBox)
  expect(
    await title.evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      shadow: getComputedStyle(element).boxShadow,
    })),
  ).toEqual({ outline: "none", shadow: "none" })
  expect(await container.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none")
  await title.fill("Renamed from Home")
  const renamed = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/rename"),
  )
  await title.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ title: "Renamed from Home" })
  let renamedRow = page.locator('[data-component="home-session-row"]').filter({ hasText: "Renamed from Home" })
  await expect(renamedRow).toBeVisible()

  await renamedRow.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Renamed from Home" })).toBeVisible()
  await page.getByRole("button", { name: "Home" }).click()
  await expect(page).toHaveURL("/")
  renamedRow = page.locator('[data-component="home-session-row"]').filter({ hasText: "Renamed from Home" })
  await expect(renamedRow).toBeVisible()

  await renamedRow.click({ button: "right" })
  const download = page.waitForEvent("download")
  const exportItem = page.getByRole("menuitem", { name: "Export..." })
  await exportItem.click()
  expect((await download).suggestedFilename()).toBe("renamed-from-home.json")
  await expect(exportItem).toBeHidden()

  await renamedRow.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete..." }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText('Delete session "Renamed from Home"?')
  const removed = page.waitForRequest(
    (request) => request.method() === "DELETE" && new URL(request.url()).pathname.endsWith(`/${fixture.targetID}`),
  )
  await dialog.getByRole("button", { name: "Delete session" }).click()
  await removed
  await expect(renamedRow).toBeHidden()
})
