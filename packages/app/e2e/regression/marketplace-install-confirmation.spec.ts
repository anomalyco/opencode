import {
  marketplaceFingerprint,
  marketplacePlanDigest,
  type MarketplaceCatalogItem,
  type MarketplaceListing,
} from "@opencode-ai/core/marketplace"
import { expect, test, type Page, type Route } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/Marketplace"
const source = {
  id: "source-test",
  name: "OpenAI Plugins",
  url: "https://github.com/openai/plugins.git",
  trust: "community" as const,
  enabled: true,
}
const catalog = {
  schema: "opencode.marketplace/v1" as const,
  id: "openai-curated",
  name: "OpenAI Plugins",
}
const compatible = item("build-web-apps", "Build Web Apps", {
  skills: { items: [{ id: "web", name: "web", path: "skills/web" }] },
})
const incompatible = item("openai-developers", "OpenAI Developers", {
  skills: { items: [{ id: "developers", name: "developers", path: "skills/developers" }] },
})
const listings: MarketplaceListing[] = [
  listing(compatible),
  {
    ...listing(incompatible),
    compatibility: { compatible: false, reasons: ["Requires capability codex-apps"] },
  },
]

test("shows planning immediately, confirms installation, and explains incompatible packages", async ({ page }) => {
  let releasePlan = () => {}
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve
  })
  const installs: unknown[] = []
  let installed = false

  await mockApp(page)
  await page.route("**/marketplace**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/marketplace" && route.request().method() === "GET") {
      return json(route, view(installed))
    }
    if (url.pathname === "/marketplace/plan") {
      await planGate
      return json(route, {
        ok: true,
        plan_id: "plan-build-web-apps",
        expires_at: "2099-01-01T00:00:00.000Z",
        key: listings[0]!.key,
        action: "install",
        listing_digest: "sha256:listing",
        plan_digest: "sha256:plan",
        compatibility: { compatible: true, reasons: [] },
        trust_warning: true,
        conflicts: [],
        permissions: ["Adds instructions that agents can load on demand"],
        summary: "1 skill",
      })
    }
    if (url.pathname === "/marketplace/install") {
      installs.push(route.request().postDataJSON())
      installed = true
      return json(route, {
        ok: true,
        changed: true,
        view: view(true),
        connect_mcp: [],
        preserved: [],
      })
    }
    return route.fallback()
  })

  await page.goto("/")
  await page.keyboard.press("Control+,")
  await page.getByRole("tab", { name: "Marketplace" }).click()
  const panel = page.locator('[data-component="marketplace-panel"]')
  await expect(panel).toBeVisible()

  const search = page.getByRole("searchbox", { name: "Search marketplace" })
  await search.fill(compatible.name)
  await page.getByRole("button", { name: "Install", exact: true }).click()

  const modal = page.locator('[data-slot="marketplace-modal"]')
  await expect(modal).toContainText("Preparing and verifying an immutable install plan")
  await expect(modal.getByRole("button", { name: "Preparing…" })).toBeDisabled()

  releasePlan()
  await expect(modal).toContainText("1 skill")
  await expect(modal).toContainText("This catalog is marked community")
  await modal.getByRole("button", { name: "Confirm" }).click()

  await expect(page.getByRole("button", { name: "Uninstall", exact: true })).toBeVisible()
  expect(installs).toEqual([
    {
      plan_id: "plan-build-web-apps",
      expected_revision: 0,
      force: false,
      accept_untrusted: true,
    },
  ])

  await search.fill(incompatible.name)
  const unsupported = page.getByRole("button", { name: "Incompatible", exact: true })
  await expect(unsupported).toBeDisabled()
  await expect(panel).toContainText("Requires capability codex-apps")
})

async function mockApp(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_marketplace",
      worktree: directory,
      vcs: "git",
      name: "Marketplace",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.route("**/pty/shells*", (route) => json(route, []))
}

function item(id: string, name: string, install: MarketplaceCatalogItem["install"]): MarketplaceCatalogItem {
  return {
    id,
    name,
    description: `${name} description`,
    kind: "plugin",
    version: "1.0.0",
    install,
  }
}

function listing(value: MarketplaceCatalogItem): MarketplaceListing {
  return {
    key: `${source.id}:${catalog.id}:${value.id}`,
    source,
    catalog,
    item: value,
    listing_digest: "sha256:listing",
    plan_digest: "sha256:plan",
    catalog_digest: "sha256:catalog",
    catalog_url: "https://raw.githubusercontent.com/openai/plugins/HEAD/.agents/plugins/marketplace.json",
    compatibility: { compatible: true, reasons: [] },
  }
}

function view(withInstall: boolean) {
  return {
    state: {
      revision: withInstall ? 1 : 0,
      installed: withInstall
        ? {
            [listings[0]!.key]: {
              source: source.id,
              catalog: catalog.id,
              item: compatible.id,
              name: compatible.name,
              kind: compatible.kind,
              version: compatible.version,
              fingerprint: marketplaceFingerprint(compatible),
              plan_digest: marketplacePlanDigest(compatible.install),
              installed_at: "2026-08-03T00:00:00.000Z",
              updated_at: "2026-08-03T00:00:00.000Z",
              snapshot: compatible,
              plan: compatible.install,
              receipt: {},
              enabled: true,
            },
          }
        : {},
    },
    listings,
    errors: [],
    cache: { objects: 3, total_bytes: 1024, fetches: 2, materializations: withInstall ? 1 : 0 },
  }
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
