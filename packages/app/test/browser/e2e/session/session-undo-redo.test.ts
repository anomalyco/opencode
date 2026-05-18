import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Page } from "playwright"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { openProjectSession, useAppBrowser } from "../../support/use-app-browser"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { createSdk, modKey, serverUrl } from "../../../../e2e/utils"

type Sdk = ReturnType<typeof createSdk>

async function seedConversation(input: { page: Page; sdk: Sdk; sessionID: string; token: string }) {
  const messages = async () =>
    await input.sdk.session.messages({ sessionID: input.sessionID, limit: 100 }).then((r) => r.data ?? [])
  const seeded = await messages()
  const userIDs = new Set(seeded.filter((m) => m.info.role === "user").map((m) => m.info.id))

  const prompt = input.page.locator(promptSelector)
  await prompt.waitFor({ state: "visible" })
  await input.sdk.session.promptAsync({
    sessionID: input.sessionID,
    noReply: true,
    parts: [{ type: "text", text: input.token }],
  })

  let userMessageID: string | undefined
  await expect
    .poll(
      async () => {
        const users = (await messages()).filter(
          (m) =>
            !userIDs.has(m.info.id) &&
            m.info.role === "user" &&
            m.parts.filter((p) => p.type === "text").some((p) => p.text.includes(input.token)),
        )
        if (users.length === 0) return false
        const user = users[users.length - 1]
        if (!user) return false
        userMessageID = user.info.id
        return true
      },
      { timeout: 90_000, interval: 250 },
    )
    .toBe(true)

  if (!userMessageID) throw new Error("Expected a user message id")
  await expect
    .poll(async () => await input.page.locator(`[data-message-id="${userMessageID}"]`).count(), { timeout: 30_000 })
    .toBe(1)
  return { prompt, userMessageID }
}

async function withFreshProject<T>(page: Page, origin: string, fn: (ctx: { sdk: Sdk; pid: string }) => Promise<T>) {
  const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
  const r = await listSdk.project.create({ name: `e2e undo project ${Date.now()}` })
  if (!r.data?.project?.id) throw new Error("project create failed")
  const pid = r.data.project.id
  const sdk = createSdk({ id: pid })
  return fn({ sdk, pid })
}

describe("session undo redo", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("slash undo sets revert and restores prior prompt", async () => {
    const token = `undo_${Date.now()}`

    await withFreshProject(app.page, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e undo ${Date.now()}`, async (session) => {
        await openProjectSession(app.page, app.origin, pid, session.id)

        const seeded = await seedConversation({ page: app.page, sdk, sessionID: session.id, token })

        await seeded.prompt.click()
        await app.page.keyboard.type("/undo")

        const undo = app.page.locator('[data-slash-id="session.undo"]').first()
        await undo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBe(seeded.userMessageID)

        await expect.poll(async () => (await seeded.prompt.innerText()).includes(token), { timeout: 10_000 }).toBe(true)
        await expect
          .poll(async () => await app.page.locator(`[data-message-id="${seeded.userMessageID}"]`).count(), {
            timeout: 30_000,
          })
          .toBe(0)
      })
    })
  }, 120_000)

  test("slash redo clears revert and restores latest state", async () => {
    const token = `redo_${Date.now()}`

    await withFreshProject(app.page, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e redo ${Date.now()}`, async (session) => {
        await openProjectSession(app.page, app.origin, pid, session.id)

        const seeded = await seedConversation({ page: app.page, sdk, sessionID: session.id, token })

        await seeded.prompt.click()
        await app.page.keyboard.type("/undo")

        const undo = app.page.locator('[data-slash-id="session.undo"]').first()
        await undo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBe(seeded.userMessageID)

        await seeded.prompt.click()
        await app.page.keyboard.press(`${modKey}+A`)
        await app.page.keyboard.press("Backspace")
        await app.page.keyboard.type("/redo")

        const redo = app.page.locator('[data-slash-id="session.redo"]').first()
        await redo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBeUndefined()

        await expect.poll(async () => (await seeded.prompt.innerText()).includes(token), { timeout: 10_000 }).toBe(false)
        await expect
          .poll(async () => await app.page.locator(`[data-message-id="${seeded.userMessageID}"]`).count(), {
            timeout: 30_000,
          })
          .toBe(1)
      })
    })
  }, 120_000)

  test("slash undo/redo traverses multi-step revert stack", async () => {
    const firstToken = `undo_redo_first_${Date.now()}`
    const secondToken = `undo_redo_second_${Date.now()}`

    await withFreshProject(app.page, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e undo redo stack ${Date.now()}`, async (session) => {
        await openProjectSession(app.page, app.origin, pid, session.id)

        const first = await seedConversation({
          page: app.page,
          sdk,
          sessionID: session.id,
          token: firstToken,
        })
        const second = await seedConversation({
          page: app.page,
          sdk,
          sessionID: session.id,
          token: secondToken,
        })

        expect(first.userMessageID).not.toBe(second.userMessageID)

        const firstMessage = app.page.locator(`[data-message-id="${first.userMessageID}"]`)
        const secondMessage = app.page.locator(`[data-message-id="${second.userMessageID}"]`)

        await expect.poll(async () => await firstMessage.count(), { timeout: 10_000 }).toBe(1)
        await expect.poll(async () => await secondMessage.count(), { timeout: 10_000 }).toBe(1)

        await second.prompt.click()
        await app.page.keyboard.press(`${modKey}+A`)
        await app.page.keyboard.press("Backspace")
        await app.page.keyboard.type("/undo")

        const undo = app.page.locator('[data-slash-id="session.undo"]').first()
        await undo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBe(second.userMessageID)

        await expect.poll(async () => await firstMessage.count(), { timeout: 10_000 }).toBe(1)
        await expect.poll(async () => await secondMessage.count(), { timeout: 10_000 }).toBe(0)

        await second.prompt.click()
        await app.page.keyboard.press(`${modKey}+A`)
        await app.page.keyboard.press("Backspace")
        await app.page.keyboard.type("/undo")
        await undo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBe(first.userMessageID)

        await expect.poll(async () => await firstMessage.count(), { timeout: 10_000 }).toBe(0)
        await expect.poll(async () => await secondMessage.count(), { timeout: 10_000 }).toBe(0)

        await second.prompt.click()
        await app.page.keyboard.press(`${modKey}+A`)
        await app.page.keyboard.press("Backspace")
        await app.page.keyboard.type("/redo")

        const redo = app.page.locator('[data-slash-id="session.redo"]').first()
        await redo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBe(second.userMessageID)

        await expect.poll(async () => await firstMessage.count(), { timeout: 10_000 }).toBe(1)
        await expect.poll(async () => await secondMessage.count(), { timeout: 10_000 }).toBe(0)

        await second.prompt.click()
        await app.page.keyboard.press(`${modKey}+A`)
        await app.page.keyboard.press("Backspace")
        await app.page.keyboard.type("/redo")
        await redo.waitFor({ state: "visible" })
        await app.page.keyboard.press("Enter")

        await expect
          .poll(async () => await sdk.session.get({ sessionID: session.id }).then((r) => r.data?.revert?.messageID), {
            timeout: 30_000,
          })
          .toBeUndefined()

        await expect.poll(async () => await firstMessage.count(), { timeout: 10_000 }).toBe(1)
        await expect.poll(async () => await secondMessage.count(), { timeout: 10_000 }).toBe(1)
      })
    })
  }, 120_000)
})
