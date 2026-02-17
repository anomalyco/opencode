import { test, expect } from "../fixtures"
import { openSidebar, withSession } from "../actions"
import { sessionItemSelector } from "../selectors"

const EXPANDED_SESSIONS_STORAGE_KEY = "opencode.global.dat:expanded-sessions"

type Sdk = Parameters<typeof withSession>[0]

async function getExpandedSessionsFromStorage(page: import("@playwright/test").Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), EXPANDED_SESSIONS_STORAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

async function seedMessage(sdk: Sdk, sessionID: string) {
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

test("expanding a session with children persists state to localStorage", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session for expansion test", async (parent) => {
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

      const beforeExpand = await getExpandedSessionsFromStorage(page)

      await chevron.click()
      await expect(childItem).toBeVisible()

      const afterExpand = await getExpandedSessionsFromStorage(page)
      const expandedKeys = Object.keys(afterExpand).filter((k) => afterExpand[k] === true)
      expect(expandedKeys.length).toBeGreaterThan(
        beforeExpand.length ? Object.keys(beforeExpand).filter((k) => beforeExpand[k] === true).length : 0,
      )
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("expanded session state persists after page reload", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session for reload test", async (parent) => {
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

      await page.reload()
      await expect(page.locator(sessionItemSelector(parent.id))).toBeVisible()

      await openSidebar(page)
      await expect(childItem).toBeVisible()
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("collapsing an expanded session updates localStorage", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent session for collapse test", async (parent) => {
    const child = await sdk.session.create({ title: "child session", parentID: parent.id }).then((r) => r.data)
    if (!child?.id) throw new Error("Failed to create child session")

    try {
      await gotoSession(parent.id)
      await openSidebar(page)

      const parentItem = page.locator(sessionItemSelector(parent.id))
      const childItem = page.locator(sessionItemSelector(child.id))
      const chevron = parentItem.locator('[data-slot="collapsible-trigger"]')

      await chevron.click()
      await expect(childItem).toBeVisible()

      const afterExpand = await getExpandedSessionsFromStorage(page)
      const expandedKeysAfterExpand = Object.keys(afterExpand).filter((k) => afterExpand[k] === true)
      expect(expandedKeysAfterExpand.length).toBeGreaterThan(0)

      await chevron.click()
      await expect(childItem).not.toBeVisible()

      const afterCollapse = await getExpandedSessionsFromStorage(page)
      const matchingKey = Object.keys(afterExpand).find((k) => k.includes(parent.id))
      if (matchingKey) {
        expect(afterCollapse[matchingKey]).toBeFalsy()
      }
    } finally {
      await sdk.session.delete({ sessionID: child.id }).catch(() => undefined)
    }
  })
})

test("multiple sessions can be expanded and all persist", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "parent 1 for multi-expand test", async (parent1) => {
    await withSession(sdk, "parent 2 for multi-expand test", async (parent2) => {
      const child1 = await sdk.session.create({ title: "child 1", parentID: parent1.id }).then((r) => r.data)
      const child2 = await sdk.session.create({ title: "child 2", parentID: parent2.id }).then((r) => r.data)
      if (!child1?.id || !child2?.id) throw new Error("Failed to create child sessions")

      try {
        await gotoSession(parent1.id)
        await openSidebar(page)

        const parent1Item = page.locator(sessionItemSelector(parent1.id))
        const parent2Item = page.locator(sessionItemSelector(parent2.id))
        const child1Item = page.locator(sessionItemSelector(child1.id))
        const child2Item = page.locator(sessionItemSelector(child2.id))

        const chevron1 = parent1Item.locator('[data-slot="collapsible-trigger"]')
        const chevron2 = parent2Item.locator('[data-slot="collapsible-trigger"]')

        await chevron1.click()
        await expect(child1Item).toBeVisible()

        await page.goto(`/${page.url().split("/")[3]}/session/${parent2.id}`)
        await openSidebar(page)
        await chevron2.click()
        await expect(child2Item).toBeVisible()

        const afterExpand = await getExpandedSessionsFromStorage(page)
        const expandedKeys = Object.keys(afterExpand).filter((k) => afterExpand[k] === true)
        expect(expandedKeys.length).toBeGreaterThanOrEqual(2)
      } finally {
        await sdk.session.delete({ sessionID: child1.id }).catch(() => undefined)
        await sdk.session.delete({ sessionID: child2.id }).catch(() => undefined)
      }
    })
  })
})
