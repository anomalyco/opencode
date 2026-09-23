import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/Projects/providers-console-signin"

const project = {
  id: "proj_providers_console",
  canonical: directory,
  name: "Providers console",
  vcs: "git",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

// Zen and the Console account share the id `opencode`: the provider comes from models.dev, the
// integration is renamed by OpencodePlugin and carries the account sign-in.
const zen = (paid: boolean) => ({
  id: "opencode",
  name: "OpenCode Zen",
  models: {
    "claude-sonnet-4-6": {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      cost: { input: paid ? 3 : 0, output: 0 },
    },
  },
})

const integrations = (connections: unknown[]) => [
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [
      { id: "device", type: "oauth", label: "OpenCode Console account" },
      { type: "key", label: "API key (service account)" },
    ],
    connections,
  },
  { id: "opencode-go", name: "OpenCode Go", methods: [{ type: "key" }], connections: [] },
  { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
]

test.use({ viewport: { width: 1280, height: 900 } })

async function openProviders(page: Page, input: { paid: boolean; connections: unknown[] }) {
  await mockOpenCodeServer(page, {
    directory,
    project,
    provider: { all: [zen(input.paid)], connected: ["opencode"], default: {} },
    integrations: integrations(input.connections),
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
    )
  }, directory)
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Popular providers" })).toBeVisible()
  return settings
}

test("fresh install offers the Console sign-in", async ({ page }) => {
  const settings = await openProviders(page, { paid: false, connections: [] })
  await expect(settings.getByText("No connected providers")).toBeVisible()
  await expect(settings.getByText("OpenCode Console", { exact: true })).toBeVisible()
})

test("a stored Zen API key keeps the Console sign-in available", async ({ page }) => {
  const settings = await openProviders(page, {
    paid: true,
    connections: [{ type: "credential", id: "cred_v1", label: "API key", method: "key" }],
  })
  const connected = settings.locator('[data-component="connected-providers-section"]')
  await expect(connected.getByText("OpenCode Zen", { exact: true })).toBeVisible()
  await expect(settings.getByText("OpenCode Console", { exact: true })).toBeVisible()
})

test("a Console account hides the sign-in row", async ({ page }) => {
  const settings = await openProviders(page, {
    paid: true,
    connections: [{ type: "credential", id: "cred_account", label: "Clara Team", method: "oauth" }],
  })
  const connected = settings.locator('[data-component="connected-providers-section"]')
  await expect(connected.getByText("OpenCode Zen", { exact: true })).toBeVisible()
  // Anthropic only exists in the integration fixture, so its row proves the integration list has loaded.
  await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
  await expect(settings.getByText("OpenCode Console", { exact: true })).toHaveCount(0)
})
