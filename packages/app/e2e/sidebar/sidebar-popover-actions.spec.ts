import { test, expect } from "../fixtures"
import {
  defocus,
  cleanupSession,
  cleanupTestProject,
  closeSidebar,
  createTestProject,
  hoverSessionItem,
  openSidebar,
  waitSession,
} from "../actions"
import { projectSwitchSelector } from "../selectors"
import { dirSlug } from "../utils"

test("collapsed sidebar popover stays open when archiving a session", async ({ page, slug, sdk, gotoSession }) => {
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

    const project = page.locator(projectSwitchSelector(slug)).first()
    await expect(project).toBeVisible()
    await project.hover()

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

test("open sidebar project popover stays closed after clicking avatar", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await withProject(
      async () => {
        await openSidebar(page)

        const project = page.locator(projectSwitchSelector(slug)).first()
        const card = page.locator('[data-component="hover-card-content"]')

        await expect(project).toBeVisible()
        await project.hover()
        await expect(card.getByText(/recent sessions/i)).toBeVisible()

        await page.mouse.down()
        await expect(card).toHaveCount(0)
        await page.mouse.up()

        await waitSession(page, { directory: other })
        await expect(card).toHaveCount(0)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("open sidebar project switch activates on first tabbed enter", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const slug = dirSlug(other)

  try {
    await withProject(
      async () => {
        await openSidebar(page)
        await defocus(page)

        const project = page.locator(projectSwitchSelector(slug)).first()

        await expect(project).toBeVisible()

        let hit = false
        for (let i = 0; i < 20; i++) {
          hit = await project.evaluate((el) => {
            return el.matches(":focus") || !!el.parentElement?.matches(":focus")
          })
          if (hit) break
          await page.keyboard.press("Tab")
        }

        expect(hit).toBe(true)

        await page.keyboard.press("Enter")
        await waitSession(page, { directory: other })
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
