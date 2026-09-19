import { expect, test, type Locator, type Page } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((session) => ({ type: "session", server, sessionId: session.id }))),
      )
    },
    { directory: fixture.directory, server: fixture.serverKey, sessions: fixture.sessions },
  )
  await page.goto("/")
  await page.locator('[data-slot="mobile-tabs-trigger"]').click()
  await expect(page.locator('[data-slot="mobile-tabs-drawer"]')).toBeVisible()
  const drawer = page.locator('[data-slot="mobile-drawer-content"]')
  await expect
    .poll(() => drawer.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
    .toBe(0)
  await expect(drawer).not.toHaveAttribute("data-transitioning")
})

test("reorders session tabs with touch", async ({ page }) => {
  const tabs = page.locator('[data-slot="vertical-tabs"] a')
  await expect(tabs).toContainText([fixture.expected.sourceTitle, fixture.expected.targetTitle])

  const target = tabs.filter({ hasText: fixture.expected.targetTitle })
  const source = tabs.filter({ hasText: fixture.expected.sourceTitle })
  const targetBox = await target.boundingBox()
  const sourceBox = await source.boundingBox()
  expect(targetBox).not.toBeNull()
  expect(sourceBox).not.toBeNull()

  await touchDrag(page, source, {
    from: { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
    to: { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
  })

  await expect(tabs).toContainText([fixture.expected.targetTitle, fixture.expected.sourceTitle])
})

test("dismisses a touch context menu by tapping outside", async ({ page }) => {
  const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
  const tab = drawer.locator('[data-slot="tab-link"]').filter({ hasText: fixture.expected.sourceTitle })
  const home = drawer.getByRole("button", { name: "Home", exact: true })
  const homeBox = await home.boundingBox()
  const box = await tab.boundingBox()
  expect(homeBox).not.toBeNull()
  expect(box).not.toBeNull()
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }

  await tab.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: point.x,
    clientY: point.y,
  })
  const rename = page.getByRole("menuitem", { name: "Rename", exact: true })
  await expect(rename).toBeVisible()
  await expect(drawer).toBeVisible()
  await tab.filter({ visible: true }).dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: point.x,
    clientY: point.y,
  })

  await page.touchscreen.tap(homeBox!.x + homeBox!.width / 2, homeBox!.y + homeBox!.height / 2)
  await expect(rename).toBeHidden()
  await expect(drawer).toBeVisible()
})

async function touchDrag(
  page: Page,
  source: Locator,
  input: { from: { x: number; y: number }; to: { x: number; y: number } },
) {
  const client = await page.context().newCDPSession(page)
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...input.from, id: 1 }],
  })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: (input.from.x + input.to.x) / 2, y: (input.from.y + input.to.y) / 2, id: 1 }],
  })
  await expect(source).toHaveCount(2)
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...input.to, id: 1 }],
  })
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
