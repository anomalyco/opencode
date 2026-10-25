import { expect, test } from "@playwright/test"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"

for (const scheme of ["light", "dark"] as const) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`mobile extensions reuse the session drawer in ${scheme} ${direction}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await mockStressTimeline(page)
      await page.addInitScript((scheme) => {
        localStorage.setItem("opencode-color-scheme", scheme)
        localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: "bottom" } }))
      }, scheme)
      const warnings: string[] = []
      page.on("console", (event) => {
        if (event.text().includes("computations created outside")) warnings.push(event.text())
      })
      await openWithDirection(page, sessionHref(fixture.targetID), direction)
      const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
      const more = tabs.getByRole("tab", { name: "More...", exact: true })
      await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Session")
      await more.click()
      await page
        .getByRole("dialog", { name: "More options", exact: true })
        .getByRole("button", { name: "Session details", exact: true })
        .click()
      const details = page.getByRole("dialog", { name: "Session details", exact: true })
      await expect(details.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
      await details.evaluate((element) => element.setAttribute("data-drawer-probe", "single"))

      for (const [name, empty] of [
        ["MCP", "No MCP servers configured"],
        ["Plugins", "No plugins configured"],
        ["Skills", "No skills configured"],
        ["LSP", "No LSP servers configured"],
      ]) {
        const trigger = details.getByRole("button", { name, exact: true })
        await trigger.click()
        const extension = page.getByRole("dialog", { name, exact: true })
        await expect(extension.getByText(empty, { exact: true })).toBeVisible()
        await expect(extension).toHaveAttribute("data-drawer-probe", "single")
        await expect(page.getByRole("dialog")).toHaveCount(1)
        await expect(page.locator('[data-slot="mobile-drawer-overlay"]')).toHaveCount(1)
        await expect(extension.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
        await expect(extension.locator(".session-service-menu")).toHaveCount(0)
        await expect(extension).toBeInViewport({ ratio: 1 })
        await extension.getByRole("button", { name: "Navigate back", exact: true }).click()
        await expect(details.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
        await expect(trigger).toBeFocused()
      }

      await details.getByRole("button", { name: "Skills", exact: true }).click()
      await expect(
        page.getByRole("dialog", { name: "Skills", exact: true }).getByText("No skills configured", { exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath("extensions.png") })
      await testInfo.attach("extensions", { path: testInfo.outputPath("extensions.png"), contentType: "image/png" })
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(more).toBeFocused()
      await more.click()
      await expect(
        page
          .getByRole("dialog", { name: "More options", exact: true })
          .getByRole("button", { name: "Files", exact: true }),
      ).toBeVisible()
      expect(warnings).toEqual([])
    })
  }
}

test("mobile extension drawers keep configured lists, retry, refresh, and MCP toggles working", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStressTimeline(page)
  const state = { fail: true, extra: false, enabled: true }
  await page.route(
    (url) => url.pathname === "/api/plugin",
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()

      if (state.fail) return route.fulfill({ status: 500, json: { message: "Unavailable" } })

      return route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data: [
            {
              id: "drawer-plugin",
              source: { type: "package", target: "drawer-plugin" },
              features: {},
              state: { status: "active" },
            },
            ...(state.extra
              ? [
                  {
                    id: "extra-plugin",
                    source: { type: "package", target: "extra-plugin" },
                    features: {},
                    state: { status: "active" },
                  },
                ]
              : []),
          ],
        },
      })
    },
  )
  await page.route(
    (url) => url.pathname === "/api/skill",
    (route) =>
      route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data: [
            { id: "drawer-skill", name: "drawer-skill", path: "/skills/drawer/SKILL.md", content: "Drawer skill" },
          ],
        },
      }),
  )
  await page.route(
    (url) => url.pathname === "/api/config",
    (route) =>
      route.fulfill({ json: [{ type: "document", info: { lsp: { "drawer-lsp": { command: ["drawer-lsp"] } } } }] }),
  )
  await page.route(
    (url) => url.pathname.startsWith("/api/mcp") || url.pathname.startsWith("/api/experimental/mcp"),
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback()
      const path = new URL(route.request().url()).pathname

      if (path.endsWith("/disconnect")) {
        state.enabled = false

        return route.fulfill({ status: 204 })
      }

      return route.fulfill({
        json: {
          location: { directory: fixture.directory },
          data:
            path === "/api/mcp/resource"
              ? { resources: [], templates: [] }
              : Array.from({ length: 30 }, (_, index) => ({
                  name: `mcp-${String(index).padStart(2, "0")}`,
                  status: { status: index === 0 && !state.enabled ? "disabled" : "connected" },
                })),
        },
      })
    },
  )
  await openWithDirection(page, sessionHref(fixture.targetID), "ltr")
  const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
  await expect(tabs.getByRole("tab", { selected: true })).toHaveText("Session")
  await tabs.getByRole("tab", { name: "More...", exact: true }).click()
  await page
    .getByRole("dialog", { name: "More options", exact: true })
    .getByRole("button", { name: "Session details", exact: true })
    .click()
  const details = page.getByRole("dialog", { name: "Session details", exact: true })
  await details.getByRole("button", { name: "Plugins", exact: true }).click()
  const plugins = page.getByRole("dialog", { name: "Plugins", exact: true })
  await expect(plugins.getByRole("alert")).toContainText("Request failed")
  state.fail = false
  await plugins.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(plugins.getByText("drawer-plugin", { exact: true })).toBeVisible()
  await plugins.getByRole("button", { name: "Navigate back", exact: true }).click()
  state.extra = true
  await details.getByRole("button", { name: "Plugins", exact: true }).click()
  await expect(plugins.getByText("extra-plugin", { exact: true })).toBeVisible()
  await plugins.getByRole("button", { name: "Navigate back", exact: true }).click()

  for (const [name, item] of [
    ["Skills", "drawer-skill"],
    ["LSP", "drawer-lsp"],
  ]) {
    await details.getByRole("button", { name, exact: true }).click()
    const extension = page.getByRole("dialog", { name, exact: true })
    await expect(extension.getByText(item, { exact: true })).toBeVisible()
    await extension.getByRole("button", { name: "Navigate back", exact: true }).click()
  }

  await details.getByRole("button", { name: "MCP", exact: true }).click()
  const mcp = page.getByRole("dialog", { name: "MCP", exact: true })
  await expect(mcp.getByRole("switch")).toHaveCount(30)
  await expect
    .poll(() =>
      mcp
        .locator('[data-slot="mobile-panel-content"]')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true)
  await expect(mcp).toBeInViewport({ ratio: 1 })
  const disconnect = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/disconnect"))
  await mcp.getByRole("switch", { name: "mcp-00", exact: true }).focus()
  await mcp.getByRole("switch", { name: "mcp-00", exact: true }).press("Space")
  await disconnect
  await expect(mcp.getByRole("switch", { name: "mcp-00", exact: true })).not.toBeChecked()

  const last = mcp
    .locator(".session-mcp-row")
    .filter({ has: page.getByRole("switch", { name: "mcp-29", exact: true }) })

  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await mcp.getByRole("switch", { name: "mcp-29", exact: true }).focus()
  await expect(mcp.getByRole("switch", { name: "mcp-29", exact: true })).toBeFocused()
})
