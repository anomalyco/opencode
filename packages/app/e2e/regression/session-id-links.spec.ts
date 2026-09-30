import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode/util/encode"
import {
  assistantMessage,
  session,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const target = "ses_0123456789abcdefghijklmnop"
const missing = "ses_abcdefghijklmnopqrstuvwxyz"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("opens a verified session from agent prose or inline code with the keyboard", async ({ page }) => {
  await setupTimeline(page, {
    sessions: [session(), session({ id: target, title: "Linked session" })],
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_session_links", `Visit ${target} or \`${target}\` to see the result.`)]),
    ],
  })
  const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `Visit ${target}` })
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.getByRole("button", { name: target })).toHaveCount(2)
  await markdown
    .getByRole("button", { name: target })
    .filter({ has: page.locator("code") })
    .press("Enter")
  await expect(page).toHaveURL(`/server/${base64Encode(server)}/session/${target}`)
  await expect(page.locator(`[data-titlebar-tab-link][href$="/session/${target}"]`)).toContainText("Linked session")
})

test("does not navigate to an ID that is absent from the current server", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_session_missing", `See ${missing}.`)])],
  })
  const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `See ${missing}.` })
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await markdown.getByRole("button", { name: missing }).click()
  await expect(page.getByText("This session cannot be found")).toBeVisible()
  await expect(page).toHaveURL(/\/session\/ses_timeline_stability$/)
})
