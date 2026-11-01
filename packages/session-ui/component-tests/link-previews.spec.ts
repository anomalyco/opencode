import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=",
  "base64",
)

const repository = "/repos/anomalyco/opencode"

const github = {
  [repository]: { full_name: "anomalyco/opencode", stargazers_count: 41_200, language: "TypeScript" },
  [`${repository}/pulls/59555`]: { title: "Restore activity ordering", state: "open", draft: false, merged: false },
  [`${repository}/pulls/59529`]: { title: "Restore desktop app-update.yml", state: "closed", merged: true },
  [`${repository}/pulls/59558`]: { title: "release: v2.2.0", state: "closed", merged: true },
  [`${repository}/issues/59561`]: { title: "Compaction messages fail to decode", state: "open", state_reason: null },
}

// Answers GitHub from fixtures, a missing path with 404, and records each request's path.
async function routeGitHub(page: Page) {
  const requests: string[] = []
  await page.route("https://www.google.com/s2/favicons**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  )
  await page.route("https://api.github.com/**", (route) => {
    const url = new URL(route.request().url())
    requests.push(url.pathname)
    const body = Object.entries(github).find(([path]) => path === url.pathname)?.[1]

    return route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body ?? { message: "Not Found" }),
    })
  })

  return requests
}

story(
  "lists the first three links with GitHub titles and states, and loads the rest when opened",
  async ({ page, mount }) => {
    const requests = await routeGitHub(page)
    const root = await mount("link-previews--mixed-links")
    const rows = root.locator('[data-slot="link-preview"]')

    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveAccessibleName("anomalyco/opencode, ★ 41.2K · TypeScript")
    await expect(rows.nth(1)).toHaveAccessibleName("anomalyco/opencode #59555, Restore activity ordering, Open")
    await expect(rows.nth(1)).toHaveAttribute("data-tone", "open")
    await expect(rows.nth(1)).toHaveAttribute("href", "https://github.com/anomalyco/opencode/pull/59555")
    await expect(rows.nth(2)).toHaveAttribute("data-tone", "merged")
    expect(requests.toSorted()).toEqual([repository, `${repository}/pulls/59529`, `${repository}/pulls/59555`])

    const more = root.getByRole("button", { name: "3 more" })
    await expect(more).toHaveAttribute("aria-expanded", "false")
    await more.click()

    await expect(rows).toHaveCount(6)
    await expect(rows.nth(3)).toHaveAccessibleName(
      "anomalyco/opencode #59561, Compaction messages fail to decode, Open",
    )
    // A commit GitHub doesn't know keeps the caption its URL gives it.
    await expect(rows.nth(4)).toHaveAccessibleName("anomalyco/opencode · 8697644, Commit")
    await expect(rows.nth(4)).toHaveAttribute("data-muted", "")
    await expect(rows.nth(5)).toHaveAccessibleName("Agents, opencode.ai")
    await expect(root.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true")
    expect(requests).toHaveLength(5)
  },
)

story("shows two links without folding", async ({ page, mount }) => {
  await routeGitHub(page)
  const root = await mount("link-previews--two-links")

  await expect(root.locator('[data-slot="link-preview"]')).toHaveCount(2)
  await expect(root.locator('[data-slot="link-preview"]').first()).toHaveAccessibleName(
    "anomalyco/opencode #59558, release: v2.2.0, Merged",
  )
  await expect(root.locator('[data-slot="link-previews-more"]')).toHaveCount(0)
})
