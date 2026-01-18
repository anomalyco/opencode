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

const mod = process.platform === "darwin" ? "Meta" : "Control"

test("search palette opens and closes", async ({ page }) => {
  const directory = await getWorktree()
  const slug = base64Encode(directory)

  await page.goto(`/${slug}/session`)
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()

  await page.keyboard.press(`${mod}+P`)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})
