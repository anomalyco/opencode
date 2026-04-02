import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { assistantText, sessionIDFromUrl } from "../actions"
import { openaiModel, promptMatch, titleMatch, withMockOpenAI } from "./mock"

test("can send a prompt and receive a reply", async ({ page, llm, backend, withBackendProject }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  try {
    await withMockOpenAI({
      serverUrl: backend.url,
      llmUrl: llm.url,
      fn: async () => {
        const token = `E2E_OK_${Date.now()}`

        await llm.textMatch(titleMatch, "E2E Title")
        await llm.textMatch(promptMatch(token), token)

        await withBackendProject(
          async (project) => {
            const prompt = page.locator(promptSelector)
            await prompt.click()
            await page.keyboard.type(`Reply with exactly: ${token}`)
            await page.keyboard.press("Enter")

            await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })

            const sessionID = (() => {
              const id = sessionIDFromUrl(page.url())
              if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)
              return id
            })()
            project.trackSession(sessionID)

            await expect.poll(() => llm.calls()).toBeGreaterThanOrEqual(1)

            await expect.poll(() => assistantText(project.sdk, sessionID), { timeout: 30_000 }).toContain(token)
          },
          {
            model: openaiModel,
          },
        )
      },
    })
  } finally {
    page.off("pageerror", onPageError)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
