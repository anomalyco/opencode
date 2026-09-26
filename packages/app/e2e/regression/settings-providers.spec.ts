import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: "reduce" } })

test("provider badges describe the active credential type", async ({ page }) => {
  const directory = "/workspace/provider-settings"
  const oauth = { type: "credential", id: "cred_oauth", label: "Personal", method: "oauth" }
  const key = { type: "credential", id: "cred_key", label: "Work", method: "key" }
  const integrations = [
    { id: "openai", name: "OpenAI", methods: [], connections: [oauth, key] },
    { id: "openrouter", name: "OpenRouter", methods: [], connections: [key, oauth] },
    { id: "google", name: "Google", methods: [], connections: [{ type: "env", name: "GOOGLE_API_KEY" }] },
    { id: "anthropic", name: "Anthropic", methods: [], connections: [] },
  ]
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_provider_settings",
      canonical: directory,
      name: "Provider settings",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    provider: {
      all: integrations.map((item) => ({
        id: item.id,
        name: item.name,
        models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
      })),
      connected: integrations.map((item) => item.id),
      default: {},
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(/\/api\/integration(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { location: { directory }, data: integrations } }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  const providers = settings.locator('[data-component="connected-providers-section"]')
  const row = (name: string) =>
    providers.locator(".settings-provider-row").filter({ has: page.getByText(name, { exact: true }) })

  await expect(row("OpenAI").getByText("Account", { exact: true })).toBeVisible()
  await expect(row("OpenRouter").getByText("API key", { exact: true })).toBeVisible()
  await expect(row("Google").getByText("Environment", { exact: true })).toBeVisible()
  await expect(row("Anthropic").getByText("Config", { exact: true })).toBeVisible()
  for (const name of ["OpenAI", "OpenRouter"]) {
    await expect(row(name).getByRole("button", { name: "Disconnect", exact: true })).toBeEnabled()
  }
  for (const name of ["Google", "Anthropic"]) {
    await expect(row(name).getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(row("OpenAI").getByText("Account", { exact: true })).toBeVisible()
  await expect(row("OpenAI").getByRole("button", { name: "Disconnect", exact: true })).toBeInViewport()
})
