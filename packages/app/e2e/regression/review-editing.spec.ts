import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test, type Page, type Request } from "@playwright/test"
import { createTwoFilesPatch } from "diff"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewEditing-linked"
const canonical = "C:/OpenCode/ReviewEditing"
const sessionDirectory = `${directory}/src`
const projectID = "proj_review_editing"
const sessionID = "ses_review_editing"
const title = "Review full-file edits"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const alpha = "src/alpha.ts"
const beta = "src/beta.ts"
const header = "// Header outside the patch"
const original = `${header}\n\nexport function greeting() {\n  return "after"\n}\n\n// Footer outside the patch\n`
const editedHeader = "// Edited outside the patch: caf\u00e9"
const edited = original.replace(header, editedHeader)

test.use({ viewport: { width: 1440, height: 900 } })

test("edits the full file and retains drafts across file and pane navigation", async ({ page }) => {
  const loading = Promise.withResolvers<void>()
  const fixture = await setup(page, { read: loading.promise })
  await openReview(page)
  const diff = page.locator('[data-slot="session-review-v2-diff-scroll"]')
  await expect(diff.getByText('return "after"', { exact: true })).toBeVisible()
  await expect(diff.getByText(header, { exact: true })).toHaveCount(0)
  if (process.env.E2E_CAPTURE_REVIEW_EDITING === "1") {
    await page.screenshot({ path: "C:/tmp/opencode/review-editing-before.png" })
  }

  const read = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/fs/read/${alpha}`)
  await page.getByRole("button", { name: "Edit file", exact: true }).click()
  expect(new URL((await read).url()).searchParams.get("location[directory]")).toBe(directory)
  await expect(page.locator('[data-slot="review-file-editor"]').getByRole("status")).toHaveText("Loading")
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled()
  loading.resolve()
  await expect(editor(page)).toHaveText(original, { useInnerText: true })
  await expect(editor(page)).toBeEditable()
  await replaceHeader(page)
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toHaveText("Unsaved")
  if (process.env.E2E_CAPTURE_REVIEW_EDITING === "1") {
    await page.screenshot({ path: "C:/tmp/opencode/review-editing-after.png" })
  }

  for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
    await editor(page).press(key)
    await expect(editor(page)).toBeFocused()
    await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("alpha.ts")
  }
  await editor(page).press("ControlOrMeta+Home")
  await editor(page).press("ControlOrMeta+]")
  await expect(editor(page).locator('[data-line="1"]')).toHaveText(/^[\t ]+\/\/ Edited outside the patch: caf\u00e9$/)
  await expect(editor(page)).toBeFocused()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("alpha.ts")
  await editor(page).press("ControlOrMeta+[")
  await expect(editor(page)).toHaveText(edited, { useInnerText: true })
  await selectFile(page, "beta.ts")
  await expect(page.getByRole("button", { name: "Edit file", exact: true })).toBeEnabled()
  await expect(page.locator('[data-slot="review-file-editor"]')).toHaveCount(0)
  await selectFile(page, "alpha.ts")
  await expect(editor(page)).toHaveText(edited, { useInnerText: true })

  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toBeHidden()
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("alpha.ts")
  await expect(editor(page)).toHaveText(edited, { useInnerText: true })
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  expect(fixture.writes).toHaveLength(0)
})

for (const save of ["button", "shortcut"] as const) {
  test(`saves full-file bytes in the linked worktree root with the ${save} and refreshes the diff`, async ({
    page,
  }) => {
    const saving = Promise.withResolvers<void>()
    const fixture = await setup(page, { write: saving.promise })
    await openReview(page)
    await page.getByRole("button", { name: "Edit file", exact: true }).click()
    await expect(editor(page)).toHaveText(original, { useInnerText: true })
    await replaceHeader(page)
    expect(fixture.writes).toHaveLength(0)

    const write = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/fs/write")
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fs/write")
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/vcs/diff" && fixture.files.get(alpha) === edited,
    )
    await (save === "button"
      ? page.getByRole("button", { name: "Save", exact: true }).click()
      : editor(page).press("ControlOrMeta+s"))
    const request = await write
    expect(request.method()).toBe("POST")
    expect(new URL(request.url()).searchParams.get("location[directory]")).toBe(directory)
    expect(request.postDataJSON()).toEqual({
      path: alpha,
      content: Buffer.from(edited).toString("base64"),
      expected: Buffer.from(original).toString("base64"),
    })
    await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeDisabled()
    saving.resolve()
    expect((await response).status()).toBe(200)
    await refreshed
    await expect(page.getByRole("button", { name: "Edit file", exact: true })).toBeEnabled()
    await expect(page.locator('[data-slot="review-file-editor"]')).toHaveCount(0)
    await expect(
      page.locator('[data-slot="session-review-v2-diff-scroll"]').getByText(editedHeader, { exact: true }),
    ).toBeVisible()
    expect(fixture.writes).toHaveLength(1)

    await page.getByRole("button", { name: "Edit file", exact: true }).click()
    await expect(editor(page)).toHaveText(edited, { useInnerText: true })
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled()
  })
}

for (const failure of ["save", "conflict"] as const) {
  test(`keeps the draft after a ${failure === "save" ? "failed" : "conflicting"} save`, async ({ page }) => {
    const fixture = await setup(page, { failure })
    await openReview(page)
    await page.getByRole("button", { name: "Edit file", exact: true }).click()
    await expect(editor(page)).toHaveText(original, { useInnerText: true })
    await replaceHeader(page)
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/fs/write")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    expect((await response).status()).toBe(failure === "conflict" ? 409 : 500)
    await expect(page.locator('[data-slot="review-file-editor"]').getByRole("alert")).toContainText(
      failure === "conflict" ? "This file changed on disk." : "Could not save this file.",
    )
    await expect(editor(page)).toHaveText(edited, { useInnerText: true })
    await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toHaveText("Unsaved")
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
    await selectFile(page, "beta.ts")
    await selectFile(page, "alpha.ts")
    await expect(editor(page)).toHaveText(edited, { useInnerText: true })
    expect(fixture.files.get(alpha)).toBe(original)
    expect(fixture.writes).toHaveLength(1)
  })
}

test("discard returns to the diff without writing and reopens the original file", async ({ page }) => {
  const fixture = await setup(page)
  await openReview(page)
  await page.getByRole("button", { name: "Edit file", exact: true }).click()
  await expect(editor(page)).toHaveText(original, { useInnerText: true })
  await replaceHeader(page)
  await page.getByRole("button", { name: "Discard", exact: true }).click()
  await expect(page.getByRole("button", { name: "Edit file", exact: true })).toBeEnabled()
  await expect(page.locator('[data-slot="review-file-editor"]')).toHaveCount(0)
  await expect(
    page.locator('[data-slot="session-review-v2-diff-scroll"]').getByText('return "after"', { exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Edit file", exact: true }).click()
  await expect(editor(page)).toHaveText(original, { useInnerText: true })
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled()
  expect(fixture.files.get(alpha)).toBe(original)
  expect(fixture.writes).toHaveLength(0)
})

function editor(page: Page) {
  return page.locator('[data-slot="review-file-editor"]').getByRole("textbox", { name: alpha, exact: true })
}

async function replaceHeader(page: Page) {
  await expect(editor(page)).toBeEditable()
  await editor(page).focus()
  await editor(page).press("ControlOrMeta+Home")
  await editor(page).press("Shift+End")
  await page.keyboard.insertText(editedHeader)
  await expect(editor(page)).toHaveText(edited, { useInnerText: true })
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
}

async function selectFile(page: Page, file: string) {
  await page.getByRole("button", { name: file, exact: true }).click()
  await expect(page.locator('[data-slot="session-review-v2-file-name"]')).toHaveText(file)
}

async function openReview(page: Page) {
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await selectFile(page, "alpha.ts")
  await expect(page.getByRole("button", { name: "Edit file", exact: true })).toBeEnabled()
}

async function setup(
  page: Page,
  options: { read?: Promise<void>; write?: Promise<void>; failure?: "save" | "conflict" } = {},
) {
  const files = new Map([
    [alpha, original],
    [beta, original.replace("greeting", "farewell")],
  ])
  const writes: Request[] = []
  const location = { directory: sessionDirectory, project: { id: projectID, directory, canonical } }
  await mockOpenCodeServer(page, {
    directory: sessionDirectory,
    project: {
      id: projectID,
      worktree: canonical,
      vcs: "git",
      name: "review-editing",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [directory],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        projectID,
        directory: sessionDirectory,
        title,
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
  })
  await page.route(/\/api\/location(?:\?.*)?$/, (route) => route.fulfill({ status: 200, json: location }))
  await page.route("**/api/fs/read/**", async (route) => {
    await options.read
    const url = new URL(route.request().url())
    const scope = url.searchParams.get("location[directory]")
    expect([directory, sessionDirectory]).toContain(scope)
    const relative = decodeURIComponent(url.pathname.slice("/api/fs/read/".length))
    const path = scope === directory ? relative : `src/${relative}`
    expect(files.has(path)).toBe(true)
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(files.get(path)!) })
  })
  await page.route("**/api/fs/write**", async (route) => {
    writes.push(route.request())
    await options.write
    const body = route.request().postDataJSON() as { path: string; content: string; expected: string }
    if (options.failure) {
      await route.fulfill({
        status: options.failure === "conflict" ? 409 : 500,
        json:
          options.failure === "conflict"
            ? { _tag: "FileSystemWriteConflictError", path: body.path, message: "File changed on disk" }
            : { message: "Fixture write failed" },
      })
      return
    }
    expect(files.has(body.path)).toBe(true)
    expect(body.expected).toBe(Buffer.from(files.get(body.path)!).toString("base64"))
    files.set(body.path, Buffer.from(body.content, "base64").toString("utf8"))
    await route.fulfill({ status: 200, json: { location: { ...location, directory }, data: true } })
  })
  await page.route("**/api/vcs/diff**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        location,
        data: [...files].map(([file, content]) => {
          const initial = file === alpha ? original : original.replace("greeting", "farewell")
          return {
            file,
            additions: content === initial ? 1 : 2,
            deletions: content === initial ? 1 : 2,
            status: "modified",
            patch: createTwoFilesPatch(
              `a/${file}`,
              `b/${file}`,
              initial.replace('"after"', '"before"'),
              content,
              undefined,
              undefined,
              { context: 0 },
            ),
          }
        }),
      },
    }),
  )
  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID },
  )
  return { files, writes }
}
