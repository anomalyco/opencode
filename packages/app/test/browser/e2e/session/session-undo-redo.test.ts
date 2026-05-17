import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"
import { createSdk, serverUrl } from "../../../../e2e/utils"
import { waitVisible } from "../../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../../support/use-app-webdriver"

type Sdk = ReturnType<typeof createSdk>

async function seedConversation(input: { driver: WebDriver; sdk: Sdk; sessionID: string; token: string }) {
  const messages = async () =>
    await input.sdk.session.messages({ sessionID: input.sessionID, limit: 100 }).then((r) => r.data ?? [])
  const seeded = await messages()
  const userIDs = new Set(seeded.filter((m) => m.info.role === "user").map((m) => m.info.id))

  const prompt = await waitVisible(input.driver, By.css(promptSelector))
  await input.sdk.session.promptAsync({
    sessionID: input.sessionID,
    noReply: true,
    parts: [{ type: "text", text: input.token }],
  })

  let userMessageID: string | undefined
  await input.driver.wait(async () => {
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
  }, 90_000)

  if (!userMessageID) throw new Error("Expected a user message id")
  await input.driver.wait(
    async () => (await input.driver.findElements(By.css(`[data-message-id="${userMessageID}"]`))).length === 1,
    30_000,
  )
  return { prompt, userMessageID }
}

async function withFreshProject<T>(driver: WebDriver, origin: string, fn: (ctx: { sdk: Sdk; pid: string }) => Promise<T>) {
  const listSdk = createOpencodeClient({ baseUrl: serverUrl, throwOnError: true })
  const r = await listSdk.project.create({ name: `e2e wd project ${Date.now()}` })
  if (!r.data?.project?.id) throw new Error("project create failed")
  const pid = r.data.project.id
  const sdk = createSdk({ id: pid })
  return fn({ sdk, pid })
}

describe("session undo redo (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("slash undo sets revert and restores prior prompt", async () => {
    const token = `undo_${Date.now()}`

    await withFreshProject(app.driver, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e undo ${Date.now()}`, async (session) => {
        await openProjectSession(app.driver, app.origin, pid, session.id)

        const seeded = await seedConversation({ driver: app.driver, sdk, sessionID: session.id, token })

        await seeded.prompt.click()
        await seeded.prompt.sendKeys("/undo")

        await waitVisible(app.driver, By.css('[data-slash-id="session.undo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === seeded.userMessageID
        }, 30_000)

        expect(await seeded.prompt.getText()).toContain(token)
        expect((await app.driver.findElements(By.css(`[data-message-id="${seeded.userMessageID}"]`))).length).toBe(0)
      })
    })
  }, 120_000)

  test("slash redo clears revert and restores latest state", async () => {
    const token = `redo_${Date.now()}`
    const mod = process.platform === "darwin" ? Key.META : Key.CONTROL

    await withFreshProject(app.driver, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e redo ${Date.now()}`, async (session) => {
        await openProjectSession(app.driver, app.origin, pid, session.id)

        const seeded = await seedConversation({ driver: app.driver, sdk, sessionID: session.id, token })

        await seeded.prompt.click()
        await seeded.prompt.sendKeys("/undo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.undo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === seeded.userMessageID
        }, 30_000)

        await seeded.prompt.click()
        await app.driver.actions().keyDown(mod).sendKeys("a").keyUp(mod).perform()
        await app.driver.actions().sendKeys(Key.BACK_SPACE).perform()
        await seeded.prompt.sendKeys("/redo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.redo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === undefined
        }, 30_000)

        expect(await seeded.prompt.getText()).not.toContain(token)
        expect((await app.driver.findElements(By.css(`[data-message-id="${seeded.userMessageID}"]`))).length).toBe(1)
      })
    })
  }, 120_000)

  test("slash undo/redo traverses multi-step revert stack", async () => {
    const firstToken = `undo_redo_first_${Date.now()}`
    const secondToken = `undo_redo_second_${Date.now()}`
    const mod = process.platform === "darwin" ? Key.META : Key.CONTROL

    await withFreshProject(app.driver, app.origin, async ({ sdk, pid }) => {
      await withSession(sdk, `e2e undo redo stack ${Date.now()}`, async (session) => {
        await openProjectSession(app.driver, app.origin, pid, session.id)

        const first = await seedConversation({
          driver: app.driver,
          sdk,
          sessionID: session.id,
          token: firstToken,
        })
        const second = await seedConversation({
          driver: app.driver,
          sdk,
          sessionID: session.id,
          token: secondToken,
        })

        expect(first.userMessageID).not.toBe(second.userMessageID)

        await second.prompt.click()
        await app.driver.actions().keyDown(mod).sendKeys("a").keyUp(mod).perform()
        await app.driver.actions().sendKeys(Key.BACK_SPACE).perform()
        await second.prompt.sendKeys("/undo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.undo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === second.userMessageID
        }, 30_000)

        expect((await app.driver.findElements(By.css(`[data-message-id="${first.userMessageID}"]`))).length).toBe(1)
        expect((await app.driver.findElements(By.css(`[data-message-id="${second.userMessageID}"]`))).length).toBe(0)

        await second.prompt.click()
        await app.driver.actions().keyDown(mod).sendKeys("a").keyUp(mod).perform()
        await app.driver.actions().sendKeys(Key.BACK_SPACE).perform()
        await second.prompt.sendKeys("/undo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.undo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === first.userMessageID
        }, 30_000)

        expect((await app.driver.findElements(By.css(`[data-message-id="${first.userMessageID}"]`))).length).toBe(0)
        expect((await app.driver.findElements(By.css(`[data-message-id="${second.userMessageID}"]`))).length).toBe(0)

        await second.prompt.click()
        await app.driver.actions().keyDown(mod).sendKeys("a").keyUp(mod).perform()
        await app.driver.actions().sendKeys(Key.BACK_SPACE).perform()
        await second.prompt.sendKeys("/redo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.redo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === second.userMessageID
        }, 30_000)

        expect((await app.driver.findElements(By.css(`[data-message-id="${first.userMessageID}"]`))).length).toBe(1)
        expect((await app.driver.findElements(By.css(`[data-message-id="${second.userMessageID}"]`))).length).toBe(0)

        await second.prompt.click()
        await app.driver.actions().keyDown(mod).sendKeys("a").keyUp(mod).perform()
        await app.driver.actions().sendKeys(Key.BACK_SPACE).perform()
        await second.prompt.sendKeys("/redo")
        await waitVisible(app.driver, By.css('[data-slash-id="session.redo"]'))
        await app.driver.actions().sendKeys(Key.ENTER).perform()

        await app.driver.wait(async () => {
          const id = await sdk.session.get({ sessionID: session.id }).then((x) => x.data?.revert?.messageID)
          return id === undefined
        }, 30_000)

        expect((await app.driver.findElements(By.css(`[data-message-id="${first.userMessageID}"]`))).length).toBe(1)
        expect((await app.driver.findElements(By.css(`[data-message-id="${second.userMessageID}"]`))).length).toBe(1)
      })
    })
  }, 120_000)
})
