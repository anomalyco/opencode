import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { assistantText, sessionIDFromUrl } from "../actions"
import { promptSelector } from "../selectors"
import { createSdk } from "../utils"
import { openaiModel, promptMatch, titleMatch, withMockOpenAI } from "./mock"

const text = (value: string | null) => (value ?? "").replace(/\u200B/g, "").trim()
type Sdk = ReturnType<typeof createSdk>

const isBash = (part: unknown): part is ToolPart => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "tool") return false
  if (!("tool" in part) || part.tool !== "bash") return false
  return "state" in part
}

async function wait(page: Page, value: string) {
  await expect.poll(async () => text(await page.locator(promptSelector).textContent())).toBe(value)
}

async function reply(sdk: Sdk, sessionID: string, token: string) {
  await expect.poll(() => assistantText(sdk, sessionID), { timeout: 90_000 }).toContain(token)
}

async function shell(sdk: Sdk, sessionID: string, cmd: string, token: string) {
  await expect
    .poll(
      async () => {
        const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
        const part = messages
          .filter((item) => item.info.role === "assistant")
          .flatMap((item) => item.parts)
          .filter(isBash)
          .find((item) => item.state.input?.command === cmd && item.state.status === "completed")

        if (!part || part.state.status !== "completed") return
        return typeof part.state.metadata?.output === "string" ? part.state.metadata.output : part.state.output
      },
      { timeout: 90_000 },
    )
    .toContain(token)
}

test("prompt history restores unsent draft with arrow navigation", async ({
  page,
  llm,
  backend,
  withBackendProject,
}) => {
  test.setTimeout(120_000)

  await withMockOpenAI({
    serverUrl: backend.url,
    llmUrl: llm.url,
    fn: async () => {
      const firstToken = `E2E_HISTORY_ONE_${Date.now()}`
      const secondToken = `E2E_HISTORY_TWO_${Date.now()}`
      const first = `Reply with exactly: ${firstToken}`
      const second = `Reply with exactly: ${secondToken}`
      const draft = `draft ${Date.now()}`

      await llm.textMatch(titleMatch, "E2E Title")
      await llm.textMatch(promptMatch(firstToken), firstToken)
      await llm.textMatch(promptMatch(secondToken), secondToken)

      await withBackendProject(
        async (project) => {
          const prompt = page.locator(promptSelector)

          await prompt.click()
          await page.keyboard.type(first)
          await page.keyboard.press("Enter")
          await wait(page, "")

          await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })
          const sessionID = sessionIDFromUrl(page.url())!
          project.trackSession(sessionID)
          await reply(project.sdk, sessionID, firstToken)

          await prompt.click()
          await page.keyboard.type(second)
          await page.keyboard.press("Enter")
          await wait(page, "")
          await reply(project.sdk, sessionID, secondToken)

          await prompt.click()
          await page.keyboard.type(draft)
          await wait(page, draft)

          await prompt.fill("")
          await wait(page, "")

          await page.keyboard.press("ArrowUp")
          await wait(page, second)

          await page.keyboard.press("ArrowUp")
          await wait(page, first)

          await page.keyboard.press("ArrowDown")
          await wait(page, second)

          await page.keyboard.press("ArrowDown")
          await wait(page, "")
        },
        {
          model: openaiModel,
        },
      )
    },
  })
})

test.fixme("shell history stays separate from normal prompt history", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const firstToken = `E2E_SHELL_ONE_${Date.now()}`
  const secondToken = `E2E_SHELL_TWO_${Date.now()}`
  const normalToken = `E2E_NORMAL_${Date.now()}`
  const first = `echo ${firstToken}`
  const second = `echo ${secondToken}`
  const normal = `Reply with exactly: ${normalToken}`

  await gotoSession()

  const prompt = page.locator(promptSelector)

  await prompt.click()
  await page.keyboard.type("!")
  await page.keyboard.type(first)
  await page.keyboard.press("Enter")
  await wait(page, "")

  await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })
  const sessionID = sessionIDFromUrl(page.url())!
  await shell(sdk, sessionID, first, firstToken)

  await prompt.click()
  await page.keyboard.type("!")
  await page.keyboard.type(second)
  await page.keyboard.press("Enter")
  await wait(page, "")
  await shell(sdk, sessionID, second, secondToken)

  await page.keyboard.press("Escape")
  await wait(page, "")

  await prompt.click()
  await page.keyboard.type("!")
  await page.keyboard.press("ArrowUp")
  await wait(page, second)

  await page.keyboard.press("ArrowUp")
  await wait(page, first)

  await page.keyboard.press("ArrowDown")
  await wait(page, second)

  await page.keyboard.press("ArrowDown")
  await wait(page, "")

  await page.keyboard.press("Escape")
  await wait(page, "")

  await prompt.click()
  await page.keyboard.type(normal)
  await page.keyboard.press("Enter")
  await wait(page, "")
  await reply(sdk, sessionID, normalToken)

  await prompt.click()
  await page.keyboard.press("ArrowUp")
  await wait(page, normal)
})
