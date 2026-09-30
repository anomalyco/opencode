import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

test("keeps a session in a removed worktree readable and movable", async ({ page }) => {
  const missing = "/projects/removed-worktree"
  const sessionDirectory = `${missing}/src`
  const destination = fixture.directory
  const sessionID = "ses_removed_worktree"
  const session = {
    id: sessionID,
    projectID: fixture.project.id,
    directory: sessionDirectory,
    title: "Removed worktree",
  }
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: destination,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Saved conversation in removed worktree", time: { created: 1 } }],
    }),
  })
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("location[directory]") !== sessionDirectory) return route.fallback()
    if (url.pathname === "/api/location")
      return route.fulfill({
        status: 404,
        json: {
          _tag: "LocationNotFoundError",
          directory: sessionDirectory,
          message: `Location not found: ${sessionDirectory}`,
        },
        headers: { "access-control-allow-origin": "*" },
      })
    if (!["/api/agent", "/api/provider", "/api/model", "/api/model/default"].includes(url.pathname))
      return route.fallback()
    return route.fulfill({
      status: 500,
      json: { _tag: "ServiceUnavailableError", message: "Unable to boot removed location" },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await page.route(`**/api/session/${sessionID}/move`, (route) => route.fulfill({ status: 204, body: "" }))

  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByText("Saved conversation in removed worktree", { exact: true })).toBeVisible()
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(page.getByRole("status")).toContainText("Session location unavailable")
  await expect(page.getByRole("status")).toContainText(sessionDirectory)
  await expect(prompt).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toBeEnabled()
  await transport.waitForConnection()
  await page.getByRole("button", { name: "Choose worktree", exact: true }).click()
  const create = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/worktree" && request.method() === "POST",
    { timeout: 10_000 },
  )
  const move = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/session/${sessionID}/move` && request.method() === "POST",
  )
  await page.getByRole("menuitem", { name: "New worktree" }).click()
  expect((await create).postDataJSON()).toMatchObject({ projectID: fixture.project.id, from: fixture.project.worktree })
  const created = `${destination}/copy`
  expect((await move).postDataJSON()).toMatchObject({ directory: created })
  session.directory = created
  await transport.send({
    id: "evt_removed_worktree_moved",
    type: "session.moved",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, location: { directory: created }, projectID: fixture.project.id },
  })
  await expect(prompt).toBeEditable()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-action="composer-model"]')).toContainText("Claude Opus 4.6")
  await expect(page.getByText("Saved conversation in removed worktree", { exact: true })).toBeVisible()
})

test("preserves a draft when a worktree disappears and resumes after choosing a directory", async ({ page }) => {
  const source = "/projects/draft-worktree"
  const destination = "/projects/restored"
  const sessionID = "ses_draft_recovery"
  const session = { id: sessionID, projectID: fixture.project.id, directory: source, title: "Draft recovery" }
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  let missing = false
  await mockOpenCodeServer(page, {
    directory: destination,
    project: { ...fixture.project, worktree: destination },
    provider: fixture.provider,
    sessions: [session],
    fileList: () => [],
    pageMessages: () => ({
      items: [{ id: "msg_draft", type: "user", text: "Saved draft history", time: { created: 1 } }],
    }),
  })
  await page.route("**/api/location?**", (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("location[directory]") !== source || !missing) return route.fallback()
    return route.fulfill({
      status: 404,
      json: { _tag: "LocationNotFoundError", directory: source, message: `Location not found: ${source}` },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  let moves = 0
  await page.route(`**/api/session/${sessionID}/move`, (route) => {
    moves++
    if (moves === 1)
      return route.fulfill({
        status: 400,
        json: { _tag: "InvalidRequestError", message: "Destination is unavailable" },
        headers: { "access-control-allow-origin": "*" },
      })
    return route.fulfill({ status: 204, body: "" })
  })

  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("A draft to keep after moving")
  const connection = await transport.waitForConnection()
  const missingResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" &&
      url.searchParams.get("location[directory]") === source &&
      response.status() === 404
    )
  })
  missing = true
  await transport.close()
  await transport.waitForConnection({ after: connection.id })
  await missingResponse
  await expect(page.getByRole("status")).toContainText("Session location unavailable")
  await expect(prompt).toHaveCount(0)
  await expect(page.getByText("Saved draft history", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Choose directory", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Choose directory", exact: true })
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await dialog.getByRole("combobox").fill(destination)
  await dialog.getByRole("combobox").press("Enter")
  await expect(dialog.locator(".directory-picker-selection")).toHaveText(destination)
  const move = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/session/${sessionID}/move` && request.method() === "POST",
  )
  await dialog.getByRole("button", { name: "Select folder", exact: true }).click()
  expect((await move).postDataJSON()).toEqual({ directory: destination })
  await expect(page.getByText("Failed to move session", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Choose directory", exact: true })).toBeEnabled()
  await expect(prompt).toHaveCount(0)
  expect(moves).toBe(1)

  await page.getByRole("button", { name: "Choose directory", exact: true }).click()
  await expect(dialog.getByRole("combobox")).toBeFocused()
  await dialog.getByRole("combobox").fill(destination)
  await dialog.getByRole("combobox").press("Enter")
  await expect(dialog.locator(".directory-picker-selection")).toHaveText(destination)
  const secondMove = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/session/${sessionID}/move` && request.method() === "POST",
  )
  await dialog.getByRole("button", { name: "Select folder", exact: true }).click()
  expect((await secondMove).postDataJSON()).toEqual({ directory: destination })
  expect(moves).toBe(2)
  session.directory = destination
  missing = false
  await transport.send({
    id: "evt_draft_recovery_moved",
    type: "session.moved",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
  })
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("A draft to keep after moving")
  await expect(page.getByText("Saved draft history", { exact: true })).toBeVisible()
})

test("ignores a stale missing result after the session moves", async ({ page }) => {
  const source = "/projects/old-worktree"
  const destination = "/projects/new-worktree"
  const sessionID = "ses_stale_location_read"
  const session = { id: sessionID, projectID: fixture.project.id, directory: source, title: "Moving session" }
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/location?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== source) return route.fallback()
    requested.resolve()
    await release.promise
    return route.fulfill({
      status: 404,
      json: { _tag: "LocationNotFoundError", directory: source, message: `Location not found: ${source}` },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await requested.promise
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Draft in new worktree")
  await transport.waitForConnection()
  const next = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" && url.searchParams.get("location[directory]") === destination && response.ok()
    )
  })
  session.directory = destination
  await transport.send({
    id: "evt_stale_probe_moved",
    type: "session.moved",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
  })
  await next
  const old = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" &&
      url.searchParams.get("location[directory]") === source &&
      response.status() === 404
    )
  })
  release.resolve()
  await old
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("Draft in new worktree")
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
})

test("moves a removed-worktree session into an existing worktree", async ({ page }) => {
  const source = "/projects/deleted-worktree"
  const destination = "/projects/existing-worktree"
  const sessionID = "ses_existing_worktree"
  const session = { id: sessionID, projectID: fixture.project.id, directory: source, title: "Existing worktree" }
  const transport = await installSseTransport(page, { server: fixture.serverKey })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: { ...fixture.project, sandboxes: [destination] },
    provider: fixture.provider,
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/location?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== source) return route.fallback()
    return route.fulfill({
      status: 404,
      json: { _tag: "LocationNotFoundError", directory: source, message: `Location not found: ${source}` },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  await page.route(`**/api/session/${sessionID}/move`, (route) => route.fulfill({ status: 204, body: "" }))
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await expect(page.getByRole("status")).toContainText("Session location unavailable")
  await transport.waitForConnection()
  await page.getByRole("button", { name: "Choose worktree", exact: true }).click()
  const option = page.getByRole("menuitem", { name: "existing-worktree", exact: true })
  await expect(option).toBeVisible()
  const move = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/session/${sessionID}/move` && request.method() === "POST",
  )
  await option.click()
  expect((await move).postDataJSON()).toEqual({ directory: destination })
  session.directory = destination
  await transport.send({
    id: "evt_existing_worktree_moved",
    type: "session.moved",
    created: 2,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, location: { directory: destination }, projectID: fixture.project.id },
  })
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(page.getByText("Session location unavailable", { exact: true })).toHaveCount(0)
})

test("recovers a missing session directory without consulting the worktree inventory", async ({ page }) => {
  const source = "/projects/unregistered-worktree"
  const sessionID = "ses_unregistered_worktree"
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [{ id: sessionID, projectID: fixture.project.id, directory: source }],
    pageMessages: () => ({
      items: [{ id: "msg_saved", type: "user", text: "Keep this session", time: { created: 1 } }],
    }),
  })
  const inventory: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/worktree")) inventory.push(request.url())
  })
  await page.route("**/api/location?**", (route) => {
    if (new URL(route.request().url()).searchParams.get("location[directory]") !== source) return route.fallback()
    return route.fulfill({
      status: 404,
      json: { _tag: "LocationNotFoundError", directory: source, message: `Location not found: ${source}` },
      headers: { "access-control-allow-origin": "*" },
    })
  })
  const missing = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === "/api/location" &&
      url.searchParams.get("location[directory]") === source &&
      response.status() === 404
    )
  })
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${sessionID}`)
  await missing
  await expect(page.getByText("Keep this session", { exact: true })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Session location unavailable")
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveCount(0)
  expect(inventory).toEqual([])
})
