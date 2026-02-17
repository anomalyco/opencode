import { test, expect } from "../fixtures"
import { openSidebar, toggleSidebar, withSession } from "../actions"
import { sessionItemSelector } from "../selectors"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  await openSidebar(page)

  await toggleSidebar(page)
  await expect(page.locator("main")).toHaveClass(/xl:border-l/)

  await toggleSidebar(page)
  await expect(page.locator("main")).not.toHaveClass(/xl:border-l/)
})

test("sidebar collapsed state persists across navigation and reload", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "sidebar persist session 1", async (session1) => {
    await withSession(sdk, "sidebar persist session 2", async (session2) => {
      await gotoSession(session1.id)

      await openSidebar(page)
      await toggleSidebar(page)
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      await gotoSession(session2.id)
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      await page.reload()
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      const opened = await page.evaluate(
        () => JSON.parse(localStorage.getItem("opencode.global.dat:layout") ?? "{}").sidebar?.opened,
      )
      await expect(opened).toBe(false)
    })
  })
})

test("session without subagents has no chevron", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "no subagents session", async (session) => {
    await gotoSession(session.id)
    await openSidebar(page)

    const sessionItem = page.locator(sessionItemSelector(session.id))
    await expect(sessionItem).toBeVisible()

    const chevron = sessionItem.locator('[data-slot="collapsible-trigger"]')
    await expect(chevron).not.toBeVisible()
  })
})

test("session with subagents shows chevron", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await gotoSession(parent.id)
      await openSidebar(page)

      const sessionItem = page.locator(sessionItemSelector(parent.id))
      await expect(sessionItem).toBeVisible()

      const chevron = sessionItem.locator('[data-slot="collapsible-trigger"]')
      await expect(chevron).toBeVisible()
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("subagents are hidden until parent session is expanded", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await gotoSession(parent.id)
      await openSidebar(page)

      const parentItem = page.locator(sessionItemSelector(parent.id))
      const childItem = page.locator(sessionItemSelector(child.id))
      const chevron = parentItem.locator('[data-slot="collapsible-trigger"]')

      await expect(parentItem).toBeVisible()
      await expect(childItem).not.toBeVisible()

      await chevron.click()
      await expect(childItem).toBeVisible()

      await chevron.click()
      await expect(childItem).not.toBeVisible()
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("root session has no back arrow or subagent indicator", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "root session", async (session) => {
    await gotoSession(session.id)

    const backButton = page.getByTestId("navigate-parent-button")
    const subagentIcon = page.getByTestId("subagent-indicator")

    await expect(backButton).not.toBeVisible()
    await expect(subagentIcon).not.toBeVisible()
  })
})

async function seedMessage(sdk: Parameters<typeof withSession>[0], sessionID: string) {
  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    parts: [{ type: "text", text: "e2e seed" }],
  })
  await expect
    .poll(
      async () => {
        const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
        return messages.length
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
}

test("subagent session shows back arrow and subagent indicator, and navigates to parent", async ({
  page,
  sdk,
  gotoSession,
}) => {
  await withSession(sdk, "parent session", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await seedMessage(sdk, child.id)
      await gotoSession(child.id)

      await expect(page.getByTestId("navigate-parent-button")).toBeVisible()
      await expect(page.getByTestId("subagent-indicator")).toBeVisible()

      await page.getByTestId("navigate-parent-button").click()
      await expect(page).toHaveURL(new RegExp(`/session/${parent.id}`))
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("subagent session selection shows background only on selected session", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await seedMessage(sdk, child.id)
      await gotoSession(child.id)
      await openSidebar(page)

      const parentItem = page.locator(sessionItemSelector(parent.id))
      const childItem = page.locator(sessionItemSelector(child.id))
      const chevron = parentItem.locator('[data-slot="collapsible-trigger"]')

      await chevron.click()
      await expect(childItem).toBeVisible()

      const parentRow = parentItem.locator("div.flex.items-center.w-full").first()
      const childRow = childItem.locator("div.flex.items-center.w-full").first()

      await expect(childRow).toHaveClass(/bg-surface-base-active/)
      await expect(parentRow).not.toHaveClass(/bg-surface-base-active/)
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("navigating to parent session shows background only on parent", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await seedMessage(sdk, child.id)
      await gotoSession(child.id)
      await openSidebar(page)

      const parentItem = page.locator(sessionItemSelector(parent.id))
      const childItem = page.locator(sessionItemSelector(child.id))
      const chevron = parentItem.locator('[data-slot="collapsible-trigger"]')

      await chevron.click()
      await expect(childItem).toBeVisible()

      await page.getByTestId("navigate-parent-button").click()
      await expect(page).toHaveURL(new RegExp(`/session/${parent.id}`))

      const parentRow = parentItem.locator("div.flex.items-center.w-full").first()
      const childRow = childItem.locator("div.flex.items-center.w-full").first()

      await expect(parentRow).toHaveClass(/bg-surface-base-active/)
      await expect(childRow).not.toHaveClass(/bg-surface-base-active/)
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})
