import { expect, story } from "../../stories/playwright/story"

story("integration picker reveals keyboard choices without moving its search or dialog", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1020, height: 400 })
  await mount("app-dialog-connect-provider--picker")
  const dialog = page.getByRole("dialog", { name: "Integrations", exact: true })
  const input = dialog.getByRole("searchbox", { name: "Search providers", exact: true })
  const container = page.locator('[data-component="dialog-v2"] [data-slot="dialog-container"]')

  const geometry = () =>
    container.evaluate((element) => {
      const dialog = element.getBoundingClientRect()
      const search = element.querySelector('input[type="search"]')!.getBoundingClientRect()

      return {
        top: dialog.top,
        height: dialog.height,
        searchTop: search.top,
        searchBottom: search.bottom,
        pageTop: window.scrollY,
      }
    })

  const order = [
    "anthropic",
    "opencode",
    "opencode-go",
    "openai",
    "github-copilot",
    "google",
    "acme-broken",
    "acme-cli",
    "acme-cloud",
    "acme-code",
    "acme-search",
    "amazon-bedrock",
    "claude-agent",
    "gitlab",
    "openrouter",
    "snowflake-cortex",
    "xai",
  ]

  await expect(input).toBeFocused()
  await expect(dialog.locator("[data-provider-id]")).toHaveCount(order.length)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await input.hover()
  const initial = await geometry()
  const last = dialog.locator('[data-provider-id="xai"]')
  await expect(last).not.toBeInViewport({ ratio: 1 })

  const moves = [
    ...order.map((id) => ({ key: "ArrowDown", id })),
    { key: "ArrowDown", id: "anthropic" },
    ...order.toReversed().map((id) => ({ key: "ArrowUp", id })),
  ]

  for (const move of moves) {
    await page.keyboard.press(move.key)
    const row = dialog.locator(`[data-provider-id="${move.id}"]`)
    await expect(row).toBeFocused()
    await expect(row).toBeInViewport({ ratio: 1 })
    await expect
      .poll(() =>
        row.evaluate((element) => {
          const scroll = element.closest(".overflow-y-auto")!

          return (
            scroll.getBoundingClientRect().bottom -
            element.getBoundingClientRect().bottom -
            parseFloat(getComputedStyle(scroll).paddingBottom)
          )
        }),
      )
      .toBeGreaterThanOrEqual(0)
    await expect.poll(geometry).toEqual(initial)
  }
})
