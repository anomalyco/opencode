import { test, expect } from "../fixtures"
import {
  defocus,
  createTestProject,
  cleanupTestProject,
  openSidebar,
  slugFromUrl,
  setWorkspacesEnabled,
  waitSession,
  waitSlug,
} from "../actions"
import { projectSwitchSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { dirSlug, modKey, resolveDirectory } from "../utils"

test("can switch between projects from sidebar", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ directory }) => {
        await defocus(page)

        const currentSlug = dirSlug(directory)
        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()

        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        const currentButton = page.locator(projectSwitchSelector(currentSlug)).first()
        await expect(currentButton).toBeVisible()
        await currentButton.click()

        await expect(page).toHaveURL(new RegExp(`/${currentSlug}/session`))
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("switching back to a project opens its session list", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  try {
    await withProject(
      async ({ slug, trackDirectory }) => {
        await defocus(page)
        await setWorkspacesEnabled(page, slug, true)
        await openSidebar(page)
        await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

        await page.getByRole("button", { name: "New workspace" }).first().click()

        const raw = await waitSlug(page, [slug])
        const dir = base64Decode(raw)
        if (!dir) throw new Error(`Failed to decode workspace slug: ${raw}`)
        const space = await resolveDirectory(dir)
        const next = dirSlug(space)
        trackDirectory(space)
        await openSidebar(page)

        const item = page.locator(`${workspaceItemSelector(next)}, ${workspaceItemSelector(raw)}`).first()
        await expect(item).toBeVisible()
        await item.hover()

        const btn = page.locator(`${workspaceNewSessionSelector(next)}, ${workspaceNewSessionSelector(raw)}`).first()
        await expect(btn).toBeVisible()
        await btn.click({ force: true })

        await waitSession(page, { directory: space })
        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click({ force: true })
        await waitSession(page, { directory: other })

        const rootButton = page.locator(projectSwitchSelector(slug)).first()
        await expect(rootButton).toBeVisible()
        await rootButton.click({ force: true })

        await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("modifier drag reorders projects without navigating", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ slug }) => {
        await defocus(page)
        await openSidebar(page)

        const list = async () => {
          const items = await page
            .locator('[data-component="sidebar-rail"] [data-action="project-switch"]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute("data-project") ?? "").filter((value) => value.length > 0),
            )
          return items.filter((item) => item === slug || item === otherSlug)
        }

        const drag = async (from: string, to: string) => {
          const src = page.locator(projectSwitchSelector(from)).first()
          const dst = page.locator(projectSwitchSelector(to)).first()
          const a = await src.boundingBox()
          const b = await dst.boundingBox()
          if (!a || !b) throw new Error("Failed to resolve project drag bounds")

          await page.keyboard.down(modKey)
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
          await page.mouse.down()
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
          await page.mouse.up()
          await page.keyboard.up(modKey)
        }

        await expect.poll(async () => await list()).toEqual([otherSlug, slug])

        const before = slugFromUrl(page.url())
        await drag(slug, otherSlug)

        await expect.poll(async () => await list()).toEqual([slug, otherSlug])
        await expect.poll(() => slugFromUrl(page.url())).toBe(before)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
