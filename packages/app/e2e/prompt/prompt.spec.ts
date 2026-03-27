import fs from "node:fs/promises"
import path from "node:path"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { sessionIDFromUrl } from "../actions"
import { createSdk } from "../utils"

async function config(dir: string, url: string) {
  await fs.writeFile(
    path.join(dir, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      enabled_providers: ["e2e-llm"],
      provider: {
        "e2e-llm": {
          name: "E2E LLM",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 128000, output: 32000 },
            },
          },
          options: {
            apiKey: "test-key",
            baseURL: url,
          },
        },
      },
      agent: {
        build: {
          model: "e2e-llm/test-model",
        },
      },
    }),
  )
}

test("can send a prompt and receive a reply", async ({ page, llm, withProject }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  try {
    await withProject(
      async (project) => {
        const sdk = createSdk(project.directory)
        const token = `E2E_OK_${Date.now()}`

        await llm.text(token)
        await project.gotoSession()

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

        await expect
          .poll(
            async () => {
              const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
              return messages
                .filter((m) => m.info.role === "assistant")
                .flatMap((m) => m.parts)
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
            },
            { timeout: 30_000 },
          )
          .toContain(token)
      },
      {
        model: { providerID: "e2e-llm", modelID: "test-model" },
        setup: (dir) => config(dir, llm.url),
      },
    )
  } finally {
    page.off("pageerror", onPageError)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
