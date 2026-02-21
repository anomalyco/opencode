import { test, expect } from "../fixtures"
import { closeSidebar, hoverSessionItem } from "../actions"
import { projectSwitchSelector, sessionItemSelector } from "../selectors"

test("collapsed sidebar popover stays open when archiving a session", async ({ page, slug, sdk, gotoSession }) => {
  const stamp = Date.now()

  const one = await sdk.session.create({ title: `e2e sidebar popover archive 1 ${stamp}` }).then((r) => r.data)
  const two = await sdk.session.create({ title: `e2e sidebar popover archive 2 ${stamp}` }).then((r) => r.data)

  if (!one?.id) throw new Error("Session create did not return an id")
  if (!two?.id) throw new Error("Session create did not return an id")

  try {
    await gotoSession(one.id)
    await closeSidebar(page)

    const project = page.locator(projectSwitchSelector(slug)).first()
    await expect(project).toBeVisible()
    await project.hover()

    await expect(page.locator(sessionItemSelector(one.id)).first()).toBeVisible()
    await expect(page.locator(sessionItemSelector(two.id)).first()).toBeVisible()

    const item = await hoverSessionItem(page, one.id)
    await item
      .getByRole("button", { name: /archive/i })
      .first()
      .click()

    await expect(page.locator(sessionItemSelector(two.id)).first()).toBeVisible()
  } finally {
    await sdk.session.delete({ sessionID: one.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: two.id }).catch(() => undefined)
  }
})
