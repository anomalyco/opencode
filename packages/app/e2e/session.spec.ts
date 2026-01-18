import { test, expect } from "@playwright/test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"

const host = process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"
const port = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const url = `http://${host}:${port}`

async function getWorktree() {
  const sdk = createOpencodeClient({ baseUrl: url, throwOnError: true })
  const result = await sdk.path.get()
  const data = result.data
  if (!data?.worktree) throw new Error(`Failed to resolve a worktree from ${url}/path`)
  return data.worktree
}

test("can open an existing session and type into the prompt", async ({ page }) => {
  const directory = await getWorktree()
  const sdk = createOpencodeClient({ baseUrl: url, directory, throwOnError: true })
  const title = `e2e smoke ${Date.now()}`
  const created = await sdk.session.create({ title }).then((r) => r.data)

  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)

    const prompt = page.locator('[data-component="prompt-input"]')
    await expect(prompt).toBeVisible()

    await prompt.click()
    await page.keyboard.type("hello from e2e")
    await expect(prompt).toContainText("hello from e2e")
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
