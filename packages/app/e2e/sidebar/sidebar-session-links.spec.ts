import { test, expect } from "../fixtures"
import { cleanupSession, openSidebar, withSession } from "../actions"
import { promptSelector } from "../selectors"
import { base64Encode } from "@opencode-ai/util/encode"

test("sidebar session links navigate to the selected session", async ({ page, project, sdk, gotoSession }) => {
  const stamp = Date.now()

  const one = await sdk.session.create({ title: `e2e sidebar nav 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e sidebar nav 2 ${stamp}` }).then((r) => r.data)

  if (!one?.id) throw new Error("Session create did not return an id")
  if (!two?.id) throw new Error("Session create did not return an id")

  try {
    await gotoSession(one.id)

    await openSidebar(page)

    const target = page.locator(`[data-session-id="${two.id}"] a`).first()
    await expect(target).toBeVisible()
    await target.click()

    // URLs are base64 encoded in the frontend
    const projectSlug = base64Encode(`/projects/${project.id}`)
    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/session/${two.id}(?:\\?|#|$)`))
    await expect(page.locator(promptSelector)).toBeVisible()
    await expect(page.locator(`[data-session-id="${two.id}"] a`).first()).toHaveClass(/\bactive\b/)
  } finally {
    await cleanupSession({ sdk, sessionID: one.id })
    await cleanupSession({ sdk, sessionID: two.id })
  }
})
