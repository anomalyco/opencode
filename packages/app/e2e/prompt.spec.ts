import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match?.[1]
}

test("can send a prompt and receive a reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  await gotoSession()

  const token = `E2E_OK_${Date.now()}`

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

  try {
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
        { timeout: 90_000 },
      )

      .toContain(token)

    const reply = page.locator('[data-slot="session-turn-summary-section"]').filter({ hasText: token }).first()
    await expect(reply).toBeVisible({ timeout: 90_000 })
  } finally {
    page.off("pageerror", onPageError)
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
