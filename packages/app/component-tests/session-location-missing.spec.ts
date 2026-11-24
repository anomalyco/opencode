import { expect, story } from "../../stories/playwright/story"

story("keeps focus in the worktree search while the pointer sweeps the rows", async ({ mount, page }) => {
  await mount("session-missing-location--many-worktrees")

  const trigger = page.getByRole("button", { name: "Choose worktree", exact: true })

  const search = page.getByPlaceholder("Search worktrees", { exact: true })

  const worktrees = page.getByText(/^opencode-/)

  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(search).toBeFocused()
  await expect(worktrees).toHaveCount(10)

  // A menu moved focus to each hovered row; the list only moves its highlight.
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await worktrees.nth(index).hover()
    await expect(search).toBeFocused()
  }

  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true)

  await trigger.click()
  await expect(search).toBeFocused()
  await page.keyboard.type("se")
  await expect(page.getByRole("option")).toHaveText([
    "New worktree",
    "opencode-settings",
    "opencode-composer",
    "opencode-search",
  ])

  await page.keyboard.press("Backspace")
  await page.keyboard.press("Backspace")
  await expect(page.getByRole("option", { name: "New worktree", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.type("se")

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Session moved to /Users/alex/work/opencode-composer", { exact: true })).toBeVisible()
})
