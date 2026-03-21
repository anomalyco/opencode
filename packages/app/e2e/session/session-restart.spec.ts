import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { runPromptSlash, withSession } from "../actions"
import { createSdk } from "../utils"
import { promptSelector } from "../selectors"

async function seedConversation(input: {
  page: Page
  sdk: ReturnType<typeof createSdk>
  sessionID: string
  token: string
}) {
  const messages = async () =>
    await input.sdk.session.messages({ sessionID: input.sessionID, limit: 100 }).then((r) => r.data ?? [])
  const seeded = await messages()
  const userIDs = new Set(seeded.filter((m) => m.info.role === "user").map((m) => m.info.id))

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
      { timeout: 90_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true)

  if (!userMessageID) throw new Error("Expected a user message id")
  return userMessageID
}

test("slash restart opens a new session draft with the initial user prompt", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  const firstToken = `restart_first_${Date.now()}`
  const secondToken = `restart_second_${Date.now()}`

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)

    await withSession(sdk, `e2e restart ${Date.now()}`, async (session) => {
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

      expect(first).not.toBe(second)

      const prompt = page.locator(promptSelector)
      await expect(prompt).toBeVisible()

      await runPromptSlash(page, { id: "session.restart", text: "/restart", prompt })

      await expect(page).toHaveURL(new RegExp(`/${project.slug}/session(?:[?#]|$)`), { timeout: 30_000 })

      await expect(prompt).toContainText(firstToken)
      await expect(prompt).not.toContainText(secondToken)
    })
  })
})
