import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test.describe("message actions", () => {
  test.beforeEach(async ({ context }) => {
    // Grant clipboard permissions for copy test
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
  })

  test("hover shows message actions menu", async ({ page, sdk, gotoSession }) => {
    const title = `e2e hover ${Date.now()}`
    const created = await sdk.session.create({ title }).then((r) => r.data)
    if (!created?.id) throw new Error("Session create failed")
    const sessionID = created.id

    try {
      const testMessage = "test hover menu"
      await sdk.session.promptAsync({
        sessionID,
        noReply: true,
        parts: [{ type: "text", text: testMessage }],
      })

      await expect
        .poll(async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
          return messages.length
        })
        .toBeGreaterThan(0)

      await gotoSession(sessionID)

      const message = page.locator("[data-message-id]").first()
      await message.hover()

      await expect(page.locator('[data-slot="message-actions-trigger"]')).toBeVisible()
    } finally {
      await sdk.session.delete({ sessionID }).catch(() => undefined)
    }
  })

  test("right-click shows context menu", async ({ page, sdk, gotoSession }) => {
    const title = `e2e context menu ${Date.now()}`
    const created = await sdk.session.create({ title }).then((r) => r.data)
    if (!created?.id) throw new Error("Session create failed")
    const sessionID = created.id

    try {
      const testMessage = "test context menu"
      await sdk.session.promptAsync({
        sessionID,
        noReply: true,
        parts: [{ type: "text", text: testMessage }],
      })

      await expect
        .poll(async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
          return messages.length
        })
        .toBeGreaterThan(0)

      await gotoSession(sessionID)

      const message = page.locator("[data-message-id]").first()
      await message.click({ button: "right" })

      await expect(page.locator('[data-component="context-menu-content"]')).toBeVisible()
    } finally {
      await sdk.session.delete({ sessionID }).catch(() => undefined)
    }
  })

  test("copy action copies message text to clipboard", async ({ page, sdk, gotoSession }) => {
    const title = `e2e copy ${Date.now()}`
    const created = await sdk.session.create({ title }).then((r) => r.data)
    if (!created?.id) throw new Error("Session create failed")
    const sessionID = created.id

    try {
      const testMessage = "test copy action"
      await sdk.session.promptAsync({
        sessionID,
        noReply: true,
        parts: [{ type: "text", text: testMessage }],
      })

      await expect
        .poll(async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
          return messages.length
        })
        .toBeGreaterThan(0)

      await gotoSession(sessionID)

      const message = page.locator("[data-message-id]").first()
      await message.hover()

      const trigger = page.locator('[data-slot="message-actions-trigger"]')
      await trigger.click()

      const copyAction = page.getByRole("menuitem", { name: "Copy" })
      await copyAction.click()

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toBe(testMessage)
    } finally {
      await sdk.session.delete({ sessionID }).catch(() => undefined)
    }
  })

  test("revert removes message and restores prompt", async ({ page, sdk, gotoSession }) => {
    const title = `e2e revert ${Date.now()}`
    const created = await sdk.session.create({ title }).then((r) => r.data)
    if (!created?.id) throw new Error("Session create failed")
    const sessionID = created.id

    try {
      const testMessage = "test revert action"
      await sdk.session.promptAsync({
        sessionID,
        noReply: true,
        parts: [{ type: "text", text: testMessage }],
      })

      let messageID: string | undefined
      await expect
        .poll(async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
          const first = messages[0]
          if (first) messageID = first.info.id
          return messages.length
        })
        .toBeGreaterThan(0)

      await gotoSession(sessionID)

      const message = page.locator("[data-message-id]").first()
      await message.hover()

      const trigger = page.locator('[data-slot="message-actions-trigger"]')
      await trigger.click()

      const revertAction = page.getByRole("menuitem", { name: "Revert" })
      await revertAction.click()

      await expect(page.locator(`[data-message-id="${messageID}"]`)).not.toBeVisible()
      await expect(page.locator(promptSelector)).toContainText(testMessage)
    } finally {
      await sdk.session.delete({ sessionID }).catch(() => undefined)
    }
  })

  test("fork creates new session and restores prompt", async ({ page, sdk, gotoSession }) => {
    const title = `e2e fork ${Date.now()}`
    const created = await sdk.session.create({ title }).then((r) => r.data)
    if (!created?.id) throw new Error("Session create failed")
    const sessionID = created.id

    try {
      const testMessage = "test fork action"
      await sdk.session.promptAsync({
        sessionID,
        noReply: true,
        parts: [{ type: "text", text: testMessage }],
      })

      await expect
        .poll(async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
          return messages.length
        })
        .toBeGreaterThan(0)

      await gotoSession(sessionID)

      const message = page.locator("[data-message-id]").first()
      await expect(message).toContainText(testMessage)
      await message.hover()

      const trigger = page.locator('[data-slot="message-actions-trigger"]')
      await trigger.click()

      const originalUrl = page.url()

      const forkAction = page.getByRole("menuitem", { name: "Fork" })
      await forkAction.click()

      await expect.poll(() => page.url()).not.toBe(originalUrl)

      const newUrl = page.url()
      const forkedSessionID = newUrl.match(/session\/([^/]+)/)?.[1]

      expect(forkedSessionID).toBeTruthy()
      expect(forkedSessionID).not.toBe(sessionID)

      // Clean up forked session first (we're on it)
      await sdk.session.delete({ sessionID: forkedSessionID! }).catch(() => undefined)
    } finally {
      // Clean up original session
      await sdk.session.delete({ sessionID }).catch(() => undefined)
    }
  })
})
