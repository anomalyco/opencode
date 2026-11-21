import { expect, story } from "../../stories/playwright/story"

story("keeps a failed shell badge on one line and truncates a long command", async ({ mount, page }) => {
  const root = await mount("timeline-next-shell-badge--failed-badge")

  // Inter's metrics decide where the command wraps, so measure only once the font is ready.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // The call sits inside its collapsed "Ran 1 command" group; open the group to reach the row.
  await root.getByRole("button", { name: "Ran 1 command" }).click()

  const group = root.locator('[data-component="context-tool-group-list"]')
  const trigger = group.locator('[data-slot="collapsible-trigger"]')
  const badge = trigger.locator('[data-component="tag"]')
  const value = trigger.locator('[data-slot="shell-submessage-value"]')

  await expect(badge).toHaveText("Exit 1")

  // The badge is 16px tall: a wrapped second line overflows it instead of growing it.
  const badgeOverflow = await badge.evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(badgeOverflow).toBe(0)

  // The command truncates inside its own box, with an ellipsis, rather than spilling past it.
  const truncated = await value.evaluate((element) => element.scrollWidth > element.clientWidth)
  expect(truncated).toBe(true)

  // The truncated command ends before the badge starts; it never runs into it.
  const geometry = await trigger.evaluate((element) => {
    const command = element.querySelector('[data-slot="shell-submessage-value"]')
    const status = element.querySelector('[data-component="tag"]')
    if (!command || !status) return null
    return {
      commandRight: command.getBoundingClientRect().right,
      badgeLeft: status.getBoundingClientRect().left,
    }
  })
  expect(geometry).not.toBeNull()
  expect(geometry?.commandRight).toBeLessThanOrEqual(geometry?.badgeLeft ?? 0)
})
