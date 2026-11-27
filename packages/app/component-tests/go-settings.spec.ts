import { expect, story } from "../../stories/playwright/story"

story("signed out, the Go page offers Subscribe and signs in to OpenCode", async ({ mount }) => {
  const page = await mount("plugins-go--signed-out")

  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/go")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Connecting opencode")
  await expect(page.getByRole("meter")).toHaveCount(0)
})

story("signed in without Go, Subscribe opens the workspace's Go page", async ({ mount }) => {
  const page = await mount("plugins-go--not-subscribed")

  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/console/wrk_story/go")
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0)
})

story("signed in with an API key, Subscribe opens the Go page and Sign in is gone", async ({ mount }) => {
  const page = await mount("plugins-go--api-key")

  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/go")
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0)
})

story("a subscriber sees each window's usage and manages the plan", async ({ mount }) => {
  const page = await mount("plugins-go--subscribed")

  await expect(page.getByRole("meter")).toHaveCount(3)
  await expect(page.getByRole("meter", { name: "Rolling" })).toHaveAttribute("aria-valuenow", "42")
  await expect(page.getByText("Limit reached")).toBeVisible()
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/console/wrk_story/go")
})

story("a failed load offers Try again, which loads the usage", async ({ mount }) => {
  const page = await mount("plugins-go--failed")

  await expect(page.getByText("Your Go usage couldn't be loaded.")).toBeVisible()
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.getByRole("meter")).toHaveCount(3)
  await expect(page.getByText("Your Go usage couldn't be loaded.")).toHaveCount(0)
})
