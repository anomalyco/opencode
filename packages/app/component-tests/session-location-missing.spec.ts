import { expect, story } from "../../stories/playwright/story"

story(
  "chooses a worktree for a session whose folder is gone from the shared worktree dialog",
  async ({ mount, page }) => {
    await mount("session-missing-location--many-worktrees")

    const trigger = page.getByRole("button", { name: "Choose worktree", exact: true })

    const search = page.getByRole("combobox", { name: "Search worktrees", exact: true })

    const rows = page.getByRole("option")

    await trigger.focus()
    await page.keyboard.press("Enter")
    await expect(search).toBeFocused()
    await expect(rows.first()).toContainText("/Users/alex/work/opencode")

    // Hovering moves the highlight, never focus, so typing still reaches the search field.
    for (const index of [2, 3, 4, 5, 6, 7, 8]) {
      await rows.nth(index).hover()
      await expect(search).toBeFocused()
    }

    await page.keyboard.press("Escape")
    await expect(search).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true)

    await page.keyboard.press("Enter")
    await expect(search).toBeFocused()
    await page.keyboard.type("comp")
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText("opencode-composer")

    // The main checkout leads the list, so clearing the search and pressing Enter moves the session there.
    await search.fill("")
    await page.keyboard.press("Enter")
    await expect(page.getByText("Session moved to /Users/alex/work/opencode", { exact: true })).toBeVisible()
  },
)
