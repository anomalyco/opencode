import type { SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { seed, sessionHref } from "../utils/app"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, openSession } from "../utils/workspace"

const tabs = (page: Page) => page.locator('[data-slot="titlebar-tabs"] a')

for (const direction of ["ltr", "rtl"] as const) {
  test(`session header groups controls and exposes session details in ${direction}`, async ({ page }) => {
    await mockStressTimeline(page)
    await seed(page, {
      projects: { local: [{ worktree: fixture.directory, expanded: true }] },
      lastProject: { local: fixture.directory },
      tabs: [fixture.sourceID, fixture.targetID],
      settings: { general: { showStatus: true } },
    })
    await page.goto(sessionHref(fixture.targetID))
    const header = page.locator("[data-session-title]")
    const more = header.getByRole("button", { name: "More options", exact: true })
    const project = header.getByRole("button", { name: fixture.project.name, exact: true })
    const review = page.getByRole("button", { name: "Toggle review", exact: true })
    const details = header.getByRole("button", { name: "Session details", exact: true })
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    await expect(review).toBeVisible()
    await expect(details).toBeVisible()
    await expect(page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Status" })).toHaveCount(0)
    const titleBounds = await header.getByRole("heading").boundingBox()
    expect(titleBounds).not.toBeNull()
    for (const editing of [false, true]) {
      if (editing) {
        await header.getByRole("heading").click()
        await expect(header.getByRole("textbox")).toHaveValue(fixture.expected.targetTitle)
        await expect(header.getByRole("textbox")).toBeFocused()
      }
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-left", "4px")
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-right", "4px")
      await expect
        .poll(async () => {
          const [icon, title, menu, sidebar, summary] = await Promise.all(
            [project, header.locator('[data-slot="session-title-child"]'), more, review, details].map((control) =>
              control.boundingBox(),
            ),
          )
          if (!icon || !title || !menu || !sidebar || !summary || !titleBounds) return false
          if (Math.abs(title.y - titleBounds.y) > 0.5 || Math.abs(title.height - titleBounds.height) > 0.5) return false
          return direction === "ltr"
            ? Math.abs(title.x - icon.x - icon.width - 2) <= 0.5 &&
                Math.abs(menu.x - title.x - title.width - 2) <= 0.5 &&
                menu.x + menu.width <= summary.x &&
                summary.x + summary.width <= sidebar.x
            : Math.abs(icon.x - title.x - title.width - 2) <= 0.5 &&
                Math.abs(title.x - menu.x - menu.width - 2) <= 0.5 &&
                sidebar.x + sidebar.width <= summary.x &&
                summary.x + summary.width <= menu.x
        })
        .toBe(true)
    }
    await header.getByRole("textbox").press("Escape")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#review-panel")).toBeVisible()
    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "false")

    await more.click()
    const options = page.getByRole("menu")
    await expect(options.getByRole("menuitem")).toHaveText(["Rename", "Export…", "Delete…"])
    if (direction === "ltr") {
      await expect
        .poll(async () => {
          const [button, menu] = await Promise.all([
            header.getByRole("button", { name: "More options", exact: true, includeHidden: true }).boundingBox(),
            options.boundingBox(),
          ])
          return button && menu ? Math.abs(button.x - menu.x) : Infinity
        })
        .toBeLessThanOrEqual(1)
    }
    await expect
      .poll(() =>
        options.evaluate((element) => {
          const menu = element.getBoundingClientRect()
          const rtl = getComputedStyle(element).direction === "rtl"
          return Math.min(
            ...Array.from(element.querySelectorAll('[data-slot="menu-v2-item-content"]'), (label) => {
              const range = document.createRange()
              range.selectNodeContents(label)
              const text = range.getBoundingClientRect()
              return rtl ? text.left - menu.left : menu.right - text.right
            }),
          )
        }),
      )
      .toBeCloseTo(32, 0)
    await expect
      .poll(() =>
        options.evaluate((element) => {
          const menu = element.getBoundingClientRect()
          const divider = element.querySelector('[data-slot="menu-v2-separator"]')?.getBoundingClientRect()
          const rows = Array.from(element.querySelectorAll('[role="menuitem"]'), (row) => row.getBoundingClientRect())
          return (
            !!divider &&
            Math.abs(divider.left - menu.left) <= 0.5 &&
            Math.abs(divider.right - menu.right) <= 0.5 &&
            rows.every(
              (row) => Math.abs(row.left - menu.left - 2) <= 0.5 && Math.abs(menu.right - row.right - 2) <= 0.5,
            )
          )
        }),
      )
      .toBe(true)
    await expect(page.getByRole("menuitem", { name: "Server status", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await details.click()
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    await expect(mcp).toBeVisible()
    await expect(summary.getByRole("button", { name: "Plugins", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(mcp).toBeHidden()
  })
}

test.describe("rename", () => {
  const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true })
  // Rename requests (`PATCH /api/session/:id`); the mock stores the new title for later reads.
  const renames: { sessionID: string; body: unknown }[] = []

  test.beforeEach(async ({ page }) => {
    renames.length = 0
    page.on("request", (request) => {
      const match = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)$/)
      if (request.method() === "PATCH" && match) renames.push({ sessionID: match[1]!, body: request.postDataJSON() })
    })
    await mockStressTimeline(page)
    await page.goto("/")
    await page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle }).click()
    await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
  })

  for (const commit of ["Enter", "blur", "click outside"]) {
    test(`saves the session heading on ${commit}`, async ({ page }) => {
      await heading(page, fixture.expected.targetTitle).click()
      const input = page.locator('input[data-slot="session-title-child"]')
      await expect(input).toBeFocused()
      await input.fill("Renamed session")
      if (commit === "Enter") await input.press("Enter")
      if (commit === "blur") await input.press("Tab")
      if (commit === "click outside") await page.locator('[data-component="composer-editor"]').click()
      await expect(heading(page, "Renamed session")).toBeVisible()
      await expect(tabs(page).filter({ hasText: "Renamed session" })).toBeVisible()
      await expect.poll(() => renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Renamed session" } }])
      await page.reload()
      await expect(heading(page, "Renamed session")).toBeVisible()
    })
  }

  for (const edit of [
    { name: "cancelled with Escape", value: "Discard this title", key: "Escape" },
    { name: "left empty", value: "   ", key: "Tab" },
  ]) {
    test(`keeps the session heading when the edit is ${edit.name}`, async ({ page }) => {
      await heading(page, fixture.expected.targetTitle).click()
      const input = page.locator('input[data-slot="session-title-child"]')
      await input.fill(edit.value)
      await input.press(edit.key)
      await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
      await page.reload()
      await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
      expect(renames).toEqual([])
    })
  }

  test("keeps the draft when saving the session heading fails", async ({ page }) => {
    await page.route("**/api/session/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } })
        : route.fallback(),
    )
    await heading(page, fixture.expected.targetTitle).click()
    const input = page.locator('input[data-slot="session-title-child"]')
    await input.fill("Retry this title")
    await input.press("Tab")
    await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
    await expect(input).toBeEnabled()
    await expect(input).toHaveValue("Retry this title")
    await expect(tabs(page).filter({ hasText: fixture.expected.targetTitle })).toBeVisible()
  })

  test("renames and closes the session tab from its context menu", async ({ page }) => {
    const tab = tabs(page).filter({ hasText: fixture.expected.targetTitle })
    await tab.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeHidden()
    await expect(tab).toBeFocused()
    await tab.press("Shift+F10")
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.locator('[data-slot="tab-title"][contenteditable="true"]')
    await expect(input).toBeFocused()
    await input.fill("Renamed from tab")
    await input.press("Enter")
    await expect(heading(page, "Renamed from tab")).toBeVisible()
    await expect.poll(() => renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Renamed from tab" } }])
    await page.reload()
    await expect(heading(page, "Renamed from tab")).toBeVisible()
    const renamed = tabs(page).filter({ hasText: "Renamed from tab" })
    await renamed.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Close tab", exact: true }).click()
    await expect(renamed).toBeHidden()
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await expect(
      page.locator('[data-component="home-session-row"]').filter({ hasText: "Renamed from tab" }),
    ).toBeVisible()
  })

  test("renames an inactive tab without switching sessions", async ({ page }) => {
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.sourceTitle }).click()
    await expect(heading(page, fixture.expected.sourceTitle)).toBeVisible()
    await tabs(page).filter({ hasText: fixture.expected.targetTitle }).click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.locator('[data-slot="tab-title"][contenteditable="true"]')
    await expect(input).toBeFocused()
    await input.fill("Inactive tab renamed")
    await input.press("Tab")
    await expect(heading(page, fixture.expected.sourceTitle)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/session/${fixture.sourceID}$`))
    await tabs(page).filter({ hasText: "Inactive tab renamed" }).click()
    await expect(heading(page, "Inactive tab renamed")).toBeVisible()
    expect(renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Inactive tab renamed" } }])
    await page.reload()
    await expect(heading(page, "Inactive tab renamed")).toBeVisible()
  })
})

test.describe("revert", () => {
  const messages = [
    { id: "msg_first", type: "user", text: "First prompt", time: { created: 1 } },
    {
      id: "msg_first_reply",
      type: "assistant",
      agent: "build",
      model: { id: "test", providerID: "opencode" },
      content: [{ type: "text", text: "First reply" }],
      time: { created: 2, completed: 3 },
    },
    { id: "msg_second", type: "user", text: "Second prompt", time: { created: 4 } },
  ] satisfies SessionMessageInfo[]
  const workspace = {
    name: "SessionMessageRevert",
    pageMessages: () => ({ items: messages }),
  }

  test("reverts directly to the selected user message", async ({ page }) => {
    const staged: { sessionID: string; messageID: string }[] = []
    const { session } = await openSession(page, { ...workspace, onRevertStage: (input) => staged.push(input) })
    const message = page.locator('[data-message-id="msg_second"]')
    await message.hover()
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${session.id}/revert/stage`,
    )
    await message.getByRole("button", { name: "Revert message" }).click()
    expect((await response).ok()).toBe(true)

    await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveText("Second prompt")
    expect(staged).toEqual([{ sessionID: session.id, messageID: "msg_second" }])
  })

  test("hides revert actions in a child session", async ({ page }) => {
    await mockWorkspace(page, {
      ...workspace,
      sessions: [
        { id: "ses_parent", title: "Parent session" },
        { id: "ses_child", title: "Session message revert", parentID: "ses_parent" },
      ],
    })
    await page.goto(sessionHref("ses_child"))
    await expectSessionTitle(page, "Session message revert")
    const message = page.locator('[data-message-id="msg_second"]')
    await message.hover()
    await expect(message.getByRole("button", { name: "Revert message" })).toHaveCount(0)
  })
})
