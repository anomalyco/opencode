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

test("terminal panel can be toggled", async ({ page }) => {
  const directory = await getWorktree()
  const slug = base64Encode(directory)

  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()

  const terminal = page.locator('[data-component="terminal"]')
  const initiallyOpen = await terminal.isVisible()
  if (initiallyOpen) {
    await page.keyboard.press("Control+Backquote")
    await expect(terminal).toHaveCount(0)
  }

  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
})
