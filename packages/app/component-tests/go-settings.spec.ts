import { expect, story } from "../../stories/playwright/story"

story("not connected, the Go page offers Subscribe and connects OpenCode", async ({ mount }) => {
  const page = await mount("plugins-go--not-connected")

  await expect(page.getByText("A subscription to the best open-weight coding models")).toBeVisible()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/go")
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Connecting opencode")
  await expect(page.getByRole("meter")).toHaveCount(0)
})

story("connected through the account, the page shows its workspace and usage", async ({ mount }) => {
  const page = await mount("plugins-go--account")

  await expect(page.getByText("Connected to Acme")).toBeVisible()
  await expect(page.getByRole("meter")).toHaveCount(3)
  await expect(page.getByRole("meter", { name: "Rolling" })).toHaveAttribute("aria-valuenow", "42")
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/console/wrk_story/go")
  await page.getByRole("button", { name: "Change connection", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Connecting opencode")
})

story("connected with a key, the page shows its usage and changes the key", async ({ mount }) => {
  const page = await mount("plugins-go--key")

  await expect(page.getByText("Connected with an API key")).toBeVisible()
  await expect(page.getByRole("meter")).toHaveCount(3)
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/go")
  await page.getByRole("button", { name: "Change connection", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Connecting opencode-go")
})

story("without an active subscription, Subscribe opens the workspace's Go page", async ({ mount }) => {
  const page = await mount("plugins-go--account-inactive")

  await expect(page.getByText("Connected to Acme")).toBeVisible()
  await expect(page.getByText("No active subscription")).toBeVisible()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/console/wrk_story/go")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0)
})

story("a key without an active subscription offers Subscribe", async ({ mount }) => {
  const page = await mount("plugins-go--key-inactive")

  await expect(page.getByText("Connected with an API key")).toBeVisible()
  await expect(page.getByText("Subscribe or renew on opencode.ai.")).toBeVisible()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Opened https://opencode.ai/go")
})

story("a window at its limit says so", async ({ mount }) => {
  const page = await mount("plugins-go--limit-reached")

  await expect(page.getByText("Limit reached")).toBeVisible()
  await expect(page.getByRole("meter", { name: "Weekly" })).toHaveAttribute("aria-valuenow", "100")
})

story("a failed load offers Try again, which loads the usage", async ({ mount }) => {
  const page = await mount("plugins-go--failed")

  await expect(page.getByText("Your Go usage couldn't be loaded.")).toBeVisible()
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.getByRole("meter")).toHaveCount(3)
  await expect(page.getByText("Your Go usage couldn't be loaded.")).toHaveCount(0)
})
