import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../support/use-e2e-stack"

import { By, pollOk, waitVisible } from "../support/wd-wait"
import { cleanupSession } from "../../../e2e/actions"
import { promptSelector } from "../../../e2e/selectors"
import { createSdk, serverUrl } from "../../../e2e/utils"
import { useAppBrowser } from "../support/use-app-browser"

describe("ai reply flow (webdriver)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test(
    "AI responds to user input",
    async () => {
      const sessionResult = await app.sdk.session.create({})
      if (!sessionResult.data) throw new Error("Failed to create session")
      const sessionID = sessionResult.data.id

      await app.gotoSession(sessionID)

      const prompt = await waitVisible(app.page, By.css(promptSelector))
      await prompt.click()
      await prompt.fill("Say hello")
      await app.page.keyboard.press("Enter")

      try {
        await pollOk(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID, limit: 50 })).data ?? []
            const assistantMessages = messages.filter((m) => m.info.role === "assistant")
            for (const msg of assistantMessages) {
              const textParts = msg.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
              if (textParts.length > 0) return true
            }
            return false
          },
          120_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID })
      }
    },
    120_000,
  )

  test(
    "complete flow - creates session, sends prompt, receives reply",
    async () => {
      const sessionResult = await app.sdk.session.create({ title: "E2E Test Session" })
      if (!sessionResult.data) throw new Error("Failed to create session")
      const session = sessionResult.data
      expect(session.projectID).toBe(app.project.id)

      await app.gotoSession(session.id)

      await app.page.evaluate(() => {
        const w = window as Window & { __e2ePageErrors?: string[] }
        w.__e2ePageErrors = []
        window.addEventListener("error", (e) => {
          w.__e2ePageErrors!.push(e.message)
        })
      })

      const token = `E2E_REPLY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const promptText = `Reply with exactly this token: ${token}`

      const prompt = await waitVisible(app.page, By.css(promptSelector))
      await prompt.click()
      await prompt.fill(promptText)
      await app.page.keyboard.press("Enter")

      try {
        await pollOk(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID: session.id, limit: 50 })).data ?? []
            const assistantMessages = messages.filter((m) => m.info.role === "assistant")
            for (const msg of assistantMessages) {
              const textParts = msg.parts.filter((p) => p.type === "text").map((p) => p.text)
              const combinedText = textParts.join("\n")
              if (combinedText.includes(token)) return true
            }
            return false
          },
          90_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID: session.id })
      }

      const errs = await app.page.evaluate(() => {
        const w = window as Window & { __e2ePageErrors?: string[] }
        return w.__e2ePageErrors ?? []
      })
      expect(Array.isArray(errs) ? errs.length : 0).toBe(0)
    },
    120_000,
  )

  test(
    "multiple sessions in same project",
    async () => {
      const session1Result = await app.sdk.session.create({ title: "Session 1" })
      const session2Result = await app.sdk.session.create({ title: "Session 2" })
      if (!session1Result.data || !session2Result.data) throw new Error("Failed to create sessions")
      const session1 = session1Result.data
      const session2 = session2Result.data

      const token1 = `SESSION1_${Date.now()}`
      const token2 = `SESSION2_${Date.now()}`

      try {
        await app.gotoSession(session1.id)
        const p1 = await waitVisible(app.page, By.css(promptSelector))
        await p1.click()
        await p1.fill(`Say: ${token1}`)
        await app.page.keyboard.press("Enter")

        await app.gotoSession(session2.id)
        const p2 = await waitVisible(app.page, By.css(promptSelector))
        await p2.click()
        await p2.fill(`Say: ${token2}`)
        await app.page.keyboard.press("Enter")

        await pollOk(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID: session1.id, limit: 50 })).data ?? []
            const texts = messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            return texts.includes(token1)
          },
          90_000,
        )

        await pollOk(
          async () => {
            const messages = (await app.sdk.session.messages({ sessionID: session2.id, limit: 50 })).data ?? []
            const texts = messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
            return texts.includes(token2)
          },
          90_000,
        )
      } finally {
        await cleanupSession({ sdk: app.sdk, sessionID: session1.id })
        await cleanupSession({ sdk: app.sdk, sessionID: session2.id })
      }
    },
    180_000,
  )

  test("using isolated project create flow", async () => {
    const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
    const created = await listSdk.project.create({ name: "Isolated Test" })
    if (!created.data?.project?.id) throw new Error("Failed to create project")
    const sdk = createSdk({ id: created.data.project.id })
    const sessionResult = await sdk.session.create({ title: "Isolated Test" })
    if (!sessionResult.data) throw new Error("Failed to create session")
    expect(sessionResult.data.projectID).toBe(created.data.project.id)
    await cleanupSession({ sdk, sessionID: sessionResult.data.id })
  })
})
