import { expect, test, type Page } from "@playwright/test"
import { session, sessionID, setupTimeline } from "../performance/timeline-stability/fixture"

test.use({ serviceWorkers: "block" })

const title = "Free limit reached"
const preference = "opencode.global.dat:go-upsell"
const message = "Free usage exceeded, subscribe to Go: https://opencode.ai/go"

async function fail(
  page: Page,
  timeline: Awaited<ReturnType<typeof setupTimeline>>,
  sequence: number,
  input: { sessionID?: string; type?: string } = {},
) {
  const error = { type: input.type ?? "provider.free-tier-limit", message: `${message} (${sequence})` }
  const id = input.sessionID ?? sessionID
  // Execution failures are server-wide events and deliberately have no location.
  await timeline.send({
    id: `evt_free_limit_${sequence}`,
    created: Date.now(),
    type: "session.execution.failed",
    durable: { aggregateID: id, seq: sequence, version: 1 },
    data: { sessionID: id, error },
  })
  await expect
    .poll(() =>
      page.evaluate(
        (message) =>
          Object.keys(localStorage)
            .filter((key) => key.includes("notification"))
            .some((key) =>
              JSON.parse(localStorage.getItem(key) ?? "{}").list?.some(
                (notification: { error?: { message?: string } }) => notification.error?.message === message,
              ),
            ),
        error.message,
      ),
    )
    .toBe(true)
}

test("free limit opens only for the current session and continues to Go connection", async ({
  page,
  context,
}, info) => {
  const other = "ses_free_limit_other"
  const timeline = await setupTimeline(page, { sessions: [session(), session({ id: other })], reducedMotion: true })
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  const dialog = page.getByRole("dialog", { name: title })

  await fail(page, timeline, 1, { sessionID: other })
  await expect(dialog).toHaveCount(0)
  await fail(page, timeline, 2, { type: "provider.error" })
  await expect(dialog).toHaveCount(0)
  await fail(page, timeline, 3)
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(
    "Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.",
  )
  await expect(dialog.getByRole("button", { name: "Subscribe", exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath("free-limit-go.png") })
  await info.attach("free-limit-go", { path: info.outputPath("free-limit-go.png"), contentType: "image/png" })

  await fail(page, timeline, 4)
  await expect(page.getByRole("dialog")).toHaveCount(1)
  await context.route("https://opencode.ai/go", (route) => route.fulfill({ body: "Go signup destination" }))
  const popup = context.waitForEvent("page")
  await dialog.getByRole("button", { name: "Subscribe", exact: true }).click()
  const signup = await popup
  await expect(signup).toHaveURL("https://opencode.ai/go")
  await signup.close()
  const connection = page.getByRole("dialog")
  await expect(connection.getByRole("textbox", { name: "API key" })).toBeEditable()
  await expect(connection).toContainText("opencode-go")
  await page.keyboard.press("Escape")
  await expect(connection).toHaveCount(0)
  await fail(page, timeline, 5)
  await expect(dialog).toHaveCount(0)
})

test("free limit respects the existing 24-hour suppression window", async ({ page }) => {
  const now = Date.now()
  await page.clock.setFixedTime(now)
  await page.addInitScript(
    ({ preference, now }) => {
      localStorage.setItem(preference, JSON.stringify({ go_upsell_last_seen_at: now - 23 * 60 * 60 * 1000 }))
    },
    { preference, now },
  )
  const timeline = await setupTimeline(page)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await fail(page, timeline, 1)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.clock.setFixedTime(now + 2 * 60 * 60 * 1000)
  await fail(page, timeline, 2)
  await expect(page.getByRole("dialog", { name: title })).toBeVisible()
})

test("do not show again persists beyond the free limit suppression window", async ({ page }) => {
  const timeline = await setupTimeline(page)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  const dialog = page.getByRole("dialog", { name: title })
  await fail(page, timeline, 1)
  await dialog.getByRole("button", { name: "Don't show again" }).click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").go_upsell_dont_show, preference))
    .toBeGreaterThan(0)
  await page.clock.setFixedTime(Date.now() + 25 * 60 * 60 * 1000)
  await fail(page, timeline, 2)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("free limit uses localized copy on mobile", async ({ page }, info) => {
  const timeline = await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    locale: "de",
    reducedMotion: true,
  })
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await fail(page, timeline, 1)
  const dialog = page.getByRole("dialog", { name: "Kostenloses Limit erreicht" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Abonnieren", exact: true })).toBeInViewport()
  await page.screenshot({ path: info.outputPath("free-limit-go-mobile.png") })
  await info.attach("free-limit-go-mobile", {
    path: info.outputPath("free-limit-go-mobile.png"),
    contentType: "image/png",
  })
})
