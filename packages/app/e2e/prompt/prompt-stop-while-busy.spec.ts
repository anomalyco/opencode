import { test, expect, type Page } from "../fixtures"
import { promptSelector } from "../selectors"
import { withSession } from "../actions"

const submitSelector = '[data-action="prompt-submit"]'
const followupDockSelector = '[data-component="session-followup-dock"]'
const docShellSelector = '[data-component="prompt-doc-shell"]'
const docSubmitSelector = `${docShellSelector} [data-action="prompt-submit"]`
const docEditorSelector = `${docShellSelector} .affine-page-root, ${docShellSelector} [contenteditable="true"]`
const normalModeSelector = '[data-action="prompt-normal"]'

const userCount = async (
  sdk: {
    session: {
      messages: (input: { sessionID: string; limit: number }) => Promise<{ data?: Array<{ info: { role: string } }> }>
    }
  },
  sessionID: string,
) => {
  const items = await sdk.session.messages({ sessionID, limit: 50 }).then((x) => x.data ?? [])
  return items.filter((item) => item.info.role === "user").length
}

const seedFollowupQueue = async (page: Page) => {
  await page.evaluate(() => {
    const key = "settings.v3"
    const raw = localStorage.getItem(key)
    const value = raw ? JSON.parse(raw) : {}
    value.general = { ...value.general, followup: "queue" }
    localStorage.setItem(key, JSON.stringify(value))
  })
}

const prepare = async (page: Page, sessionID: string, gotoSession: (sessionID?: string) => Promise<void>) => {
  await gotoSession(sessionID)
  await seedFollowupQueue(page)
  await gotoSession(sessionID)
  await page.locator(`${docShellSelector}, ${promptSelector}`).first().waitFor({ timeout: 60_000 })
}

const trackAbort = async (page: Page, sessionID: string) => {
  let aborts = 0
  await page.route(`**/session/${sessionID}/abort`, async (route) => {
    aborts += 1
    await route.continue()
  })
  return () => aborts
}

const sendNormal = async (page: Page, text: string) => {
  await page.locator(normalModeSelector).first().click()
  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type(text)
  await page.keyboard.press("Enter")
}

const sendDoc = async (page: Page, text: string) => {
  const editor = page.locator(docEditorSelector).first()
  await editor.click({ timeout: 30_000 })
  await page.keyboard.type(text)
  await page.keyboard.press("Shift+Enter")
}

test.describe("normal mode", () => {
  test("submit button aborts while session is busy with empty input", async ({ page, sdk, gotoSession }) => {
    test.setTimeout(120_000)

    await withSession(sdk, `e2e busy stop ${Date.now()}`, async (session) => {
      const aborts = await trackAbort(page, session.id)
      await prepare(page, session.id, gotoSession)

      const submit = page.locator(submitSelector)
      const token = `busy-stop-${Date.now()}`

      await sendNormal(page, `Reply with exactly: ${token}`)
      await expect(submit).toHaveAttribute("data-icon", "stop", { timeout: 60_000 })

      await submit.click()
      await expect.poll(aborts, { timeout: 15_000 }).toBeGreaterThan(0)
    })
  })

  test("submit button queues follow-up while session is busy", async ({ page, sdk, gotoSession }) => {
    test.setTimeout(120_000)

    await withSession(sdk, `e2e busy queue ${Date.now()}`, async (session) => {
      const aborts = await trackAbort(page, session.id)
      await prepare(page, session.id, gotoSession)

      const prompt = page.locator(promptSelector)
      const submit = page.locator(submitSelector)
      const dock = page.locator(followupDockSelector)
      const token = `busy-queue-${Date.now()}`

      await sendNormal(page, `Reply with exactly: ${token}`)
      await expect(submit).toHaveAttribute("data-icon", "stop", { timeout: 60_000 })

      const before = await userCount(sdk, session.id)
      await page.locator(normalModeSelector).first().click()
      await prompt.click()
      await page.keyboard.type("follow-up queued message")
      await expect(submit).toHaveAttribute("data-icon", "arrow-up-bold", { timeout: 15_000 })
      await submit.click()

      await expect(dock).toBeVisible({ timeout: 15_000 })
      await expect(dock).toContainText("follow-up queued message")
      expect(aborts()).toBe(0)
      await expect.poll(async () => userCount(sdk, session.id), { timeout: 15_000 }).toBe(before)
    })
  })

  test("enter queues follow-up while session is busy", async ({ page, sdk, gotoSession }) => {
    test.setTimeout(120_000)

    await withSession(sdk, `e2e busy enter queue ${Date.now()}`, async (session) => {
      const aborts = await trackAbort(page, session.id)
      await prepare(page, session.id, gotoSession)

      const prompt = page.locator(promptSelector)
      const submit = page.locator(submitSelector)
      const dock = page.locator(followupDockSelector)
      const token = `busy-enter-queue-${Date.now()}`

      await sendNormal(page, `Reply with exactly: ${token}`)
      await expect(submit).toHaveAttribute("data-icon", "stop", { timeout: 60_000 })

      const before = await userCount(sdk, session.id)
      await page.locator(normalModeSelector).first().click()
      await prompt.click()
      await page.keyboard.type("follow-up enter queue")
      await expect(submit).toHaveAttribute("data-icon", "arrow-up-bold", { timeout: 15_000 })
      await page.keyboard.press("Enter")

      await expect(dock).toBeVisible({ timeout: 15_000 })
      await expect(dock).toContainText("follow-up enter queue")
      expect(aborts()).toBe(0)
      await expect.poll(async () => userCount(sdk, session.id), { timeout: 15_000 }).toBe(before)
    })
  })
})

test.describe("doc mode", () => {
  test("submit button aborts while session is busy with empty doc", async ({ page, sdk, gotoSession }) => {
    test.setTimeout(120_000)

    await withSession(sdk, `e2e doc busy stop ${Date.now()}`, async (session) => {
      const aborts = await trackAbort(page, session.id)
      await prepare(page, session.id, gotoSession)

      const submit = page.locator(docSubmitSelector)
      const token = `doc-busy-stop-${Date.now()}`

      await sendDoc(page, `Reply with exactly: ${token}`)
      await expect(submit).toHaveAttribute("data-icon", "stop", { timeout: 60_000 })

      await submit.click()
      await expect.poll(aborts, { timeout: 15_000 }).toBeGreaterThan(0)
    })
  })

  test("submit button queues follow-up while session is busy", async ({ page, sdk, gotoSession }) => {
    test.setTimeout(120_000)

    await withSession(sdk, `e2e doc busy queue ${Date.now()}`, async (session) => {
      const aborts = await trackAbort(page, session.id)
      await prepare(page, session.id, gotoSession)

      const submit = page.locator(docSubmitSelector)
      const dock = page.locator(followupDockSelector)
      const token = `doc-busy-queue-${Date.now()}`

      await sendDoc(page, `Reply with exactly: ${token}`)
      await expect(submit).toHaveAttribute("data-icon", "stop", { timeout: 60_000 })

      const before = await userCount(sdk, session.id)
      await sendDoc(page, "doc follow-up queued")
      await expect(submit).toHaveAttribute("data-icon", "arrow-up-bold", { timeout: 15_000 })
      await submit.click()

      await expect(dock).toBeVisible({ timeout: 15_000 })
      await expect(dock).toContainText("doc follow-up queued")
      expect(aborts()).toBe(0)
      await expect.poll(async () => userCount(sdk, session.id), { timeout: 15_000 }).toBe(before)
    })
  })
})
