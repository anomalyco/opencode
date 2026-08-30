import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("keeps history visible and recovers the composer by choosing another directory", async ({ page }) => {
  const directory = "/projects/deleted"
  const destination = "/projects/restored"
  const sessionID = "ses_missing_location"
  const session = { id: sessionID, projectID: fixture.project.id, directory, title: "Missing location" }
  const events: OpenCodeEvent[] = []
  const moves: unknown[] = []
  await mockOpenCodeServer(page, {
    directory: destination,
    project: { ...fixture.project, worktree: destination },
    provider: fixture.provider,
    sessions: [session],
    events: () => events.splice(0),
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Keep this session history", time: { created: 1 } }],
    }),
  })
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== directory) return route.fallback()
    return route.fulfill({ status: 500, body: "", headers: { "access-control-allow-origin": "*" } })
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await expect(page.getByText("Keep this session history", { exact: true })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Session location unavailable")
  await expect(page.getByRole("status")).toContainText(directory)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveCount(0)
  const choose = page.getByRole("button", { name: "Choose directory", exact: true })
  await expect(choose).toBeEnabled()
  await choose.click()
  const dialog = page.getByRole("dialog", { name: "Choose directory", exact: true })
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await dialog.getByRole("combobox").press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(choose).toBeFocused()
  expect(moves).toEqual([])

  // The server can still reject a destination after it was selected in the picker.
  await page.route(`**/api/session/${sessionID}/move`, (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    moves.push(route.request().postDataJSON())
    return route.fulfill({
      status: 400,
      json: { _tag: "InvalidRequestError", message: "Destination is unavailable" },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await choose.press("Enter")
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await dialog.getByRole("combobox").fill(destination)
  await dialog.getByRole("combobox").press("Enter")
  await expect(dialog.locator(".directory-picker-selection")).toHaveText(destination)
  await dialog.getByRole("button", { name: "Select folder", exact: true }).click()
  await expect(page.getByText("Failed to move session", { exact: true })).toBeVisible()
  await expect(choose).toBeEnabled()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveCount(0)
  await expect(choose).toBeFocused()
  expect(moves).toEqual([{ directory: destination }])

  await page.route(`**/api/session/${sessionID}/move`, (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    moves.push(route.request().postDataJSON())
    session.directory = destination
    events.push({
      id: "evt_location_recovered",
      type: "session.moved",
      created: 2,
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
    })
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
  })
  await choose.click()
  await dialog.getByRole("combobox").fill(destination)
  await dialog.getByRole("combobox").press("Enter")
  await expect(dialog.locator(".directory-picker-selection")).toHaveText(destination)
  await dialog.getByRole("button", { name: "Select folder", exact: true }).click()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(page.locator('[data-action="composer-model"]')).toBeVisible()
  await expect(page.getByText("Keep this session history", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  expect(moves).toEqual([{ directory: destination }, { directory: destination }])
})

for (const create of [false, true]) {
  test(`recovers into ${create ? "a new" : "an existing"} worktree without resolving the deleted location`, async ({
    page,
  }) => {
    const canonical = "/projects/repository"
    const directory = "/projects/deleted-worktree"
    const destination = create ? "/projects/new-worktree" : "/projects/existing-worktree"
    const sessionID = "ses_worktree_recovery"
    const events: OpenCodeEvent[] = []
    const requests: { operation: string; body: unknown }[] = []
    let listing = Promise.withResolvers<void>()
    let listingRequested = Promise.withResolvers<void>()
    const moving = Promise.withResolvers<void>()
    const moveRequested = Promise.withResolvers<void>()
    await mockOpenCodeServer(page, {
      directory: canonical,
      project: { ...fixture.project, worktree: canonical },
      provider: fixture.provider,
      sessions: [{ id: sessionID, projectID: fixture.project.id, directory }],
      pageMessages: () => ({
        items: [{ id: "msg_worktree", type: "user", text: "Recover my worktree", time: { created: 1 } }],
      }),
      events: () => events.splice(0),
    })
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url())
      const headers = { "access-control-allow-origin": "*" }
      if (url.searchParams.get("location[directory]") === directory)
        return route.fulfill({ status: 500, body: "", headers })
      if (url.pathname === `/api/worktree/${fixture.project.id}`) {
        if (route.request().method() === "GET") {
          listingRequested.resolve()
          await listing.promise
          return route.fulfill({
            json: [
              { directory: canonical, strategy: null },
              { directory: "/projects/existing-worktree", strategy: "git" },
            ],
            headers,
          })
        }
        if (route.request().method() === "POST") {
          requests.push({ operation: "create", body: route.request().postDataJSON() })
          return route.fulfill({
            json: { directory: destination, name: "new-worktree", branch: "new-worktree" },
            headers,
          })
        }
      }
      if (url.pathname === `/api/session/${sessionID}/move` && route.request().method() === "POST") {
        requests.push({ operation: "move", body: route.request().postDataJSON() })
        moveRequested.resolve()
        await moving.promise
        events.push({
          id: "evt_worktree_recovered",
          type: "session.moved",
          created: 2,
          durable: { aggregateID: sessionID, seq: 1, version: 1 },
          data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
        })
        return route.fulfill({ status: 204, headers })
      }
      return route.fallback()
    })
    await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
    await page.getByRole("button", { name: "Choose worktree", exact: true }).click()
    await listingRequested.promise
    await expect(page.getByRole("menuitem", { name: "Loading", exact: true })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "New workspace", exact: true })).toBeVisible()
    await expect(page.getByText("Recover my worktree", { exact: true })).toBeVisible()
    await expect(page.getByText("Session location unavailable", { exact: true })).toBeVisible()
    listing.resolve()
    await expect(page.getByRole("menuitem", { name: "existing-worktree", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    listing = Promise.withResolvers<void>()
    listingRequested = Promise.withResolvers<void>()
    await page.getByRole("button", { name: "Choose worktree", exact: true }).click()
    await listingRequested.promise
    await expect(page.getByRole("menuitem", { name: "existing-worktree", exact: true })).toBeVisible()
    await expect(page.getByText("Recover my worktree", { exact: true })).toBeVisible()
    listing.resolve()
    await page.getByRole("menuitem", { name: create ? "New workspace" : "existing-worktree", exact: true }).click()
    await moveRequested.promise
    await expect(page.getByRole("button", { name: "Moving session…", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Choose worktree", exact: true })).toBeDisabled()
    moving.resolve()
    await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
    await expect(page.getByText("Recover my worktree", { exact: true })).toBeVisible()
    expect(requests).toEqual([
      ...(create ? [{ operation: "create", body: { strategy: "git", from: canonical, directory: "/projects/" } }] : []),
      { operation: "move", body: { directory: destination } },
    ])
  })
}
