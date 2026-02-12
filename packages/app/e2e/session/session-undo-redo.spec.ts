import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { withSession } from "../actions"
import { createSdk, modKey } from "../utils"
import { promptSelector } from "../selectors"

async function seedConversation(input: {
  page: Page
  sdk: ReturnType<typeof createSdk>
  sessionID: string
  token: string
}) {
  const prompt = input.page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await prompt.click()
  await input.page.keyboard.type(`Reply with exactly: ${input.token}`)
  await input.page.keyboard.press("Enter")

  let userMessageID: string | undefined
  await expect
    .poll(
      async () => {
        const messages = await input.sdk.session
          .messages({ sessionID: input.sessionID, limit: 50 })
          .then((r) => r.data ?? [])
        const users = messages.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.filter((p) => p.type === "text").some((p) => p.text.includes(input.token)),
        )
        if (users.length === 0) return false

        const user = users[users.length - 1]
        if (!user) return false
        userMessageID = user.info.id

        const assistantText = messages
          .filter((m) => m.info.role === "assistant")
          .flatMap((m) => m.parts)
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")

        return assistantText.includes(input.token)
      },
      { timeout: 90_000 },
    )
    .toBe(true)

  if (!userMessageID) throw new Error("Expected a user message id")
  return { prompt, userMessageID }
}

test("slash undo sets revert and restores prior prompt", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  const token = `undo_${Date.now()}`

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e undo ${Date.now()}`, async (session) => {
      await project.gotoSession(session.id)

      const seeded = await seedConversation({ page, sdk, sessionID: session.id, token })

      await seeded.prompt.click()
      await page.keyboard.type("/undo")

      const undo = page.locator('[data-slash-id="session.undo"]').first()
      await expect(undo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBe(seeded.userMessageID)

      await expect(seeded.prompt).toContainText(token)
      await expect(page.locator(`[data-message-id="${seeded.userMessageID}"]`)).toHaveCount(0)
    })
  })
})

test("slash redo clears revert and restores latest state", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  const token = `redo_${Date.now()}`

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e redo ${Date.now()}`, async (session) => {
      await project.gotoSession(session.id)

      const seeded = await seedConversation({ page, sdk, sessionID: session.id, token })

      await seeded.prompt.click()
      await page.keyboard.type("/undo")

      const undo = page.locator('[data-slash-id="session.undo"]').first()
      await expect(undo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBe(seeded.userMessageID)

      await seeded.prompt.click()
      await page.keyboard.press(`${modKey}+A`)
      await page.keyboard.press("Backspace")
      await page.keyboard.type("/redo")

      const redo = page.locator('[data-slash-id="session.redo"]').first()
      await expect(redo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBeUndefined()

      await expect(seeded.prompt).not.toContainText(token)
      await expect(page.locator(`[data-message-id="${seeded.userMessageID}"]`).first()).toBeVisible()
    })
  })
})

test("slash undo/redo traverses multi-step revert stack", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  const firstToken = `undo_redo_first_${Date.now()}`
  const secondToken = `undo_redo_second_${Date.now()}`

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e undo redo stack ${Date.now()}`, async (session) => {
      await project.gotoSession(session.id)

      const first = await seedConversation({
        page,
        sdk,
        sessionID: session.id,
        token: firstToken,
      })
      const second = await seedConversation({
        page,
        sdk,
        sessionID: session.id,
        token: secondToken,
      })

      expect(first.userMessageID).not.toBe(second.userMessageID)

      const firstMessage = page.locator(`[data-message-id="${first.userMessageID}"]`)
      const secondMessage = page.locator(`[data-message-id="${second.userMessageID}"]`)

      await expect(firstMessage.first()).toBeVisible()
      await expect(secondMessage.first()).toBeVisible()

      await second.prompt.click()
      await page.keyboard.press(`${modKey}+A`)
      await page.keyboard.press("Backspace")
      await page.keyboard.type("/undo")

      const undo = page.locator('[data-slash-id="session.undo"]').first()
      await expect(undo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBe(second.userMessageID)

      await expect(firstMessage.first()).toBeVisible()
      await expect(secondMessage).toHaveCount(0)

      await second.prompt.click()
      await page.keyboard.press(`${modKey}+A`)
      await page.keyboard.press("Backspace")
      await page.keyboard.type("/undo")
      await expect(undo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBe(first.userMessageID)

      await expect(firstMessage).toHaveCount(0)
      await expect(secondMessage).toHaveCount(0)

      await second.prompt.click()
      await page.keyboard.press(`${modKey}+A`)
      await page.keyboard.press("Backspace")
      await page.keyboard.type("/redo")

      const redo = page.locator('[data-slash-id="session.redo"]').first()
      await expect(redo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBe(second.userMessageID)

      await expect(firstMessage.first()).toBeVisible()
      await expect(secondMessage).toHaveCount(0)

      await second.prompt.click()
      await page.keyboard.press(`${modKey}+A`)
      await page.keyboard.press("Backspace")
      await page.keyboard.type("/redo")
      await expect(redo).toBeVisible()
      await page.keyboard.press("Enter")

      await expect
        .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
          timeout: 30_000,
        })
        .toBeUndefined()

      await expect(firstMessage.first()).toBeVisible()
      await expect(secondMessage.first()).toBeVisible()
    })
  })
})
