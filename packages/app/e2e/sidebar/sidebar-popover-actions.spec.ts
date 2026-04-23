import { test, expect } from "../fixtures"
import { cleanupSession, closeSidebar, hoverSessionItem } from "../actions"
import { projectSwitchSelector } from "../selectors"
import { base64Encode } from "@opencode-ai/util/encode"

test("collapsed sidebar popover stays open when archiving a session", async ({ page, project, sdk, gotoSession }) => {
  const stamp = Date.now()

  const one = await sdk.session.create({ title: `e2e sidebar popover archive 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e sidebar popover archive 2 ${stamp}` }).then((r) => r.data)

  if (!one?.id) throw new Error("Session create did not return an id")
  if (!two?.id) throw new Error("Session create did not return an id")

  try {
    await gotoSession(one.id)
    await closeSidebar(page)

    const oneItem = page.locator(`[data-session-id="${one.id}"]`).last()
    const twoItem = page.locator(`[data-session-id="${two.id}"]`).last()

    const projectButton = page.locator(projectSwitchSelector(base64Encode(`/projects/${project.id}`))).first()
    await expect(projectButton).toBeVisible()
    await projectButton.hover()

    await expect(oneItem).toBeVisible()
    await expect(twoItem).toBeVisible()

    const item = await hoverSessionItem(page, one.id)
    await item
      .getByRole("button", { name: /archive/i })
      .first()
      .click()

    await expect(twoItem).toBeVisible()
  } finally {
    await cleanupSession({ sdk, sessionID: one.id })
    await cleanupSession({ sdk, sessionID: two.id })
  }
})
