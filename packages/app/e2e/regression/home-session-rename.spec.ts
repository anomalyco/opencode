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

for (const commit of ["Enter", "Tab"]) {
  test(`renames a home session without opening it on ${commit}`, async ({ page }) => {
    await page.getByRole("button", { name: "Home", exact: true }).click()
    const row = page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.sourceTitle })
    const tabs = page.locator('[data-slot="titlebar-tabs"] a')
    await expect(tabs.filter({ hasText: fixture.expected.sourceTitle })).toHaveCount(0)
    await row.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.getByRole("textbox", { name: "Rename", exact: true })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(fixture.expected.sourceTitle)
    await input.fill("  Renamed from home  ")
    await input.press(commit)
    const renamed = page.locator('[data-component="home-session-row"]').filter({ hasText: "Renamed from home" })
    await expect(renamed).toBeVisible()
    await expect(page).toHaveURL("/")
    await expect(tabs.filter({ hasText: "Renamed from home" })).toHaveCount(0)
    await page.reload()
    await expect(renamed).toBeVisible()
    await renamed.click()
    await expect(page.getByRole("heading", { name: "Renamed from home", exact: true })).toBeVisible()
  })
}

test("renames a home session using the keyboard and updates its open tab", async ({ page }) => {
  await page.getByRole("button", { name: "Home", exact: true }).click()
  const row = page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle })
  await row.click({ button: "right" })
  await page.keyboard.press("Escape")
  await expect(row).toBeFocused()
  await row.press("Shift+F10")
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const input = page.getByRole("textbox", { name: "Rename", exact: true })
  await expect(input).toBeFocused()
  await input.fill("Home and tab renamed")
  await input.press("Enter")
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Home and tab renamed" })).toBeVisible()
  await expect(
    page.locator('[data-component="home-session-row"]').filter({ hasText: "Home and tab renamed" }),
  ).toBeVisible()
  await expect(page).toHaveURL("/")
})

test("cancels home renaming and ignores blank or unchanged titles", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/session\/[^/]+(?:\?.*)?$/.test(request.url())) requests.push(request.url())
  })
  await page.getByRole("button", { name: "Home", exact: true }).click()
  const row = page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.sourceTitle })
  for (const [title, key] of [
    ["Discard this title", "Escape"],
    ["   ", "Enter"],
    [fixture.expected.sourceTitle, "Tab"],
  ]) {
    await row.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.getByRole("textbox", { name: "Rename", exact: true })
    await expect(input).toBeFocused()
    await input.fill(title)
    await input.press(key)
    await expect(input).toBeHidden()
    await expect(row).toBeVisible()
  }
  await page.reload()
  await expect(row).toBeVisible()
  expect(requests).toEqual([])
})

test("keeps a home rename draft after failure and allows retry", async ({ page }) => {
  await page.route(
    /\/session\/[^/]+(?:\?.*)?$/,
    (route) => {
      if (route.request().method() !== "PATCH") return route.fallback()
      return route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } })
    },
    { times: 1 },
  )
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page
    .locator('[data-component="home-session-row"]')
    .filter({ hasText: fixture.expected.targetTitle })
    .click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const input = page.getByRole("textbox", { name: "Rename", exact: true })
  await expect(input).toBeFocused()
  await input.fill("Retry home rename")
  await input.press("Enter")
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(input).toHaveValue("Retry home rename")
  await expect(input).toBeEditable()
  await expect(
    page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: fixture.expected.targetTitle }),
  ).toBeVisible()
  await input.press("Enter")
  await expect(
    page.locator('[data-component="home-session-row"]').filter({ hasText: "Retry home rename" }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Retry home rename" })).toBeVisible()
})

test("does not submit a home rename twice while saving", async ({ page }) => {
  const pending = Promise.withResolvers<void>()
  const requests: string[] = []
  await page.route(/\/session\/[^/]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    requests.push(route.request().url())
    await pending.promise
    await route.fallback()
  })
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page
    .locator('[data-component="home-session-row"]')
    .filter({ hasText: fixture.expected.sourceTitle })
    .click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const input = page.getByRole("textbox", { name: "Rename", exact: true })
  await expect(input).toBeFocused()
  await input.fill("Delayed rename")
  await input.press("Enter")
  await expect(input).toHaveAttribute("aria-busy", "true")
  await expect(input).not.toBeEditable()
  await input.press("Enter")
  await input.press("Tab")
  pending.resolve()
  await expect(page.locator('[data-component="home-session-row"]').filter({ hasText: "Delayed rename" })).toBeVisible()
  expect(requests).toHaveLength(1)
})

test("still opens home sessions in the background with middle click", async ({ page }) => {
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page
    .locator('[data-component="home-session-row"]')
    .filter({ hasText: fixture.expected.sourceTitle })
    .click({ button: "middle" })
  await expect(
    page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: fixture.expected.sourceTitle }),
  ).toBeVisible()
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeHidden()
})
