import { expect, story } from "../../storybook/playwright/story"

for (const scale of [1, 1.25, 2]) {
  for (const theme of ["light", "dark"] as const) {
    story.describe(`${theme} at ${scale}x`, () => {
      story.use({ deviceScaleFactor: scale, colorScheme: theme })

      story("centres unread dots and cutouts on the avatar corner", async ({ mount }) => {
        const component = await mount("ui-project-avatar--all-variants-unread", { globals: { theme } })
        const avatars = component.locator('[data-component="project-avatar-v2"]')
        await expect(avatars).toHaveCount(9)

        for (const avatar of await avatars.all()) {
          const geometry = await avatar.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const dot = element.querySelector('[data-slot="project-avatar-unread-dot"]')!.getBoundingClientRect()
            const surface = element.querySelector('[data-slot="project-avatar-surface"]')!
            return {
              x: dot.x + dot.width / 2 - box.right,
              y: dot.y + dot.height / 2 - box.top,
              mask: getComputedStyle(surface).maskImage,
            }
          })

          expect(geometry.x).toBe(0)
          expect(geometry.y).toBe(0)
          expect(geometry.mask).toContain("at 100% 0px")
        }
      })
    })
  }
}

story("keeps read avatars unmasked", async ({ mount }) => {
  const component = await mount("ui-project-avatar--all-variants")
  await expect(component.locator('[data-component="project-avatar-v2"]')).toHaveCount(9)
  await expect(component.locator('[data-slot="project-avatar-unread-dot"]')).toHaveCount(0)
  for (const surface of await component.locator('[data-slot="project-avatar-surface"]').all()) {
    await expect(surface).toHaveCSS("mask-image", "none")
  }
})
