import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { mockStressTimeline, stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { openWithDirection } from "../utils/direction"

for (const layout of ["horizontal", "vertical"] as const) {
  test(`summary persists both disclosures across sessions with ${layout} tabs`, async ({ page }, testInfo) => {
    await mockStressTimeline(page)
    await page.addInitScript((layout) => {
      const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          ...settings,
          appearance: { ...settings.appearance, tabLayout: layout },
          general: { ...settings.general, showStatus: true },
        }),
      )
    }, layout)
    await page.goto(stressSessionHref(fixture.targetID))
    const trigger = page.getByRole("button", { name: "Session details", exact: true })
    await expect(trigger).toBeEnabled()
    await expect(page.getByRole("button", { name: "Status", exact: true })).toHaveCount(0)
    await trigger.click()
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const project = summary.getByRole("button", { name: fixture.project.name, exact: true })
    const server = summary.getByRole("button", { name: "Server", exact: true })
    await expect(project).toHaveAttribute("aria-expanded", "true")
    await expect(server).toHaveAttribute("aria-expanded", "true")
    for (const heading of [project, server]) {
      await expect(heading).toHaveCSS("column-gap", "8px")
      await expect(heading.locator(".session-summary-heading-label")).toHaveCSS("column-gap", "4px")
      await expect(heading.locator(".session-summary-disclosure")).toHaveAttribute("width", "16")
      await expect(heading.locator(".session-summary-disclosure")).toHaveAttribute("height", "16")
    }
    await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
    await testInfo.attach(`summary-${layout}`, { body: await page.screenshot(), contentType: "image/png" })
    await project.click()
    await expect(project).toHaveAttribute("aria-expanded", "false")
    await expect(summary.getByRole("button", { name: "No changes", exact: true })).toHaveCount(0)
    await expect(server).toHaveAttribute("aria-expanded", "true")
    await server.click()
    await expect(summary.getByRole("button", { name: "MCP", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(summary).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(project).toHaveAttribute("aria-expanded", "false")
    await expect(server).toHaveAttribute("aria-expanded", "false")
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").sessionSummary))
      .toEqual({ projectExpanded: false, serverExpanded: false })

    await page.goto(stressSessionHref(fixture.sourceID))
    await trigger.click()
    await expect(project).toHaveAttribute("aria-expanded", "false")
    await expect(server).toHaveAttribute("aria-expanded", "false")
    await server.click()
    await expect(summary.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
    await expect(project).toHaveAttribute("aria-expanded", "false")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    await expect(settings).toBeVisible()
    await expect(settings.getByText("Server status", { exact: true })).toHaveCount(0)
  })
}

for (const direction of ["ltr", "rtl"] as const) {
  test(`service submenus open on click and stay aligned with the view in ${direction}`, async ({ page }, testInfo) => {
    await mockStressTimeline(page)
    await openWithDirection(page, stressSessionHref(fixture.targetID), direction)
    await expect(page.getByRole("button", { name: "Session details", exact: true })).toBeEnabled()
    await expect(page.locator("html")).toHaveAttribute("dir", direction)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    const warnings: string[] = []
    page.on("console", (event) => {
      if (event.text().includes("computations created outside")) warnings.push(event.text())
    })
    await page.getByRole("button", { name: "Session details", exact: true }).click()
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    const submenu = page.getByRole("dialog", { name: "MCP", exact: true })
    await mcp.hover()
    await expect(submenu).toHaveCount(0)
    await mcp.click()
    await expect(submenu.getByText("No MCP servers configured yet", { exact: true })).toBeVisible()
    await expect(summary).toBeVisible()
    await expect
      .poll(async () => {
        const row = await mcp.boundingBox()
        const menu = await submenu.boundingBox()
        if (!row || !menu) return false
        return direction === "ltr" ? menu.x + menu.width <= row.x : menu.x >= row.x + row.width
      })
      .toBe(true)
    await testInfo.attach(`summary-submenu-${direction}`, { body: await page.screenshot(), contentType: "image/png" })
    await page.keyboard.press("Escape")
    await expect(submenu).toBeHidden()
    await expect(summary).toBeVisible()
    await expect(mcp).toBeFocused()
    await mcp.press("Enter")
    await expect(submenu.getByText("Add servers in opencode.json")).toBeVisible()
    await mcp.click()
    await expect(submenu).toBeHidden()

    for (const [name, text] of [
      ["Plugins", "No plugins configured yet"],
      ["Skills", "No skills configured yet"],
      ["LSP", "No LSP servers explicitly configured"],
    ]) {
      await summary.getByRole("button", { name, exact: true }).click()
      await expect(page.getByRole("dialog", { name, exact: true }).getByText(text, { exact: true })).toBeVisible()
      await expect(submenu).toBeHidden()
    }
    await summary.getByRole("button", { name: "Server", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "LSP", exact: true })).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(summary).toBeHidden()

    for (const reviewOpen of [false, true]) {
      if (reviewOpen) await page.getByRole("button", { name: "Toggle review", exact: true }).click()
      await page.getByRole("button", { name: "Session details", exact: true }).click()
      await expect(summary).toBeVisible()
      await expect
        .poll(async () => {
          const header = await page.locator("[data-session-title]").boundingBox()
          const panel = await summary.boundingBox()
          if (!header || !panel) return Infinity
          return direction === "ltr"
            ? Math.abs(header.x + header.width - panel.x - panel.width - 12)
            : Math.abs(panel.x - header.x - 12)
        })
        .toBeLessThanOrEqual(1)
      await page.keyboard.press("Escape")
    }
    expect(warnings).toEqual([])
  })
}

test("catalog submenus show project plugins and skills, refresh on reopen, and distinguish errors from empty", async ({
  page,
}, testInfo) => {
  await mockStressTimeline(page)
  const state = { fail: true, extra: false }
  const requests: string[] = []
  await page.route("**/api/plugin**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    requests.push(new URL(route.request().url()).searchParams.get("location[directory]") ?? "")
    if (state.fail) return route.fulfill({ status: 500, json: { message: "Unavailable" } })
    return route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data: [
          { id: "builtin", source: { type: "builtin" }, features: {}, state: { status: "active" } },
          {
            id: "supermemory",
            source: { type: "package", target: "opencode-supermemory" },
            features: { server: true },
            state: { status: "active" },
          },
          {
            id: "broken-plugin",
            source: { type: "local", path: "/broken.ts" },
            features: { server: true },
            state: { status: "failed", error: "Plugin failed to activate" },
          },
          ...(state.extra
            ? [
                {
                  id: "daytona",
                  source: { type: "package", target: "opencode-daytona" },
                  features: {},
                  state: { status: "active" },
                },
              ]
            : []),
        ],
      },
    })
  })
  await page.route("**/api/skill**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    return route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data: [
          { id: "find-skills", name: "find-skills", location: "/skills/find/SKILL.md", content: "Find skills" },
          {
            id: "review-animations",
            name: "review-animations",
            location: "/skills/review/SKILL.md",
            content: "Review animations",
          },
        ],
      },
    })
  })
  await page.route("**/api/config**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    return route.fulfill({
      json: [
        {
          type: "document",
          info: {
            lsp: {
              typescript: { command: ["typescript-language-server", "--stdio"] },
              rust: { command: ["rust-analyzer"] },
            },
          },
        },
        { type: "document", info: { lsp: { rust: { disabled: true } } } },
      ],
    })
  })
  await page.goto(stressSessionHref(fixture.targetID))
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  const summary = page.getByRole("dialog", { name: "Session details", exact: true })
  await summary.getByRole("button", { name: "Plugins", exact: true }).click()
  const plugins = page.getByRole("dialog", { name: "Plugins", exact: true })
  await expect(plugins.getByRole("alert")).toContainText("Request failed")
  await expect(plugins.getByText("No plugins configured yet", { exact: true })).toHaveCount(0)
  state.fail = false
  await plugins.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(plugins.getByText("supermemory", { exact: true })).toBeVisible()
  await expect(plugins.getByText("builtin", { exact: true })).toHaveCount(0)
  await expect(plugins.getByTitle("Plugin failed to activate")).toContainText("Failed")
  expect(requests.every((directory) => directory === fixture.directory)).toBe(true)
  await testInfo.attach("summary-plugins", { body: await page.screenshot(), contentType: "image/png" })
  await page.keyboard.press("Escape")
  state.extra = true
  await summary.getByRole("button", { name: "Plugins", exact: true }).click()
  await expect(plugins.getByText("daytona", { exact: true })).toBeVisible()
  await summary.getByRole("button", { name: "Skills", exact: true }).click()
  const skills = page.getByRole("dialog", { name: "Skills", exact: true })
  await expect(skills.getByText("find-skills", { exact: true })).toBeVisible()
  await expect(skills.getByText("review-animations", { exact: true })).toBeVisible()
  await expect(plugins).toBeHidden()
  await summary.getByRole("button", { name: "LSP", exact: true }).click()
  const lsp = page.getByRole("dialog", { name: "LSP", exact: true })
  await expect(lsp.getByText("Configured LSPs", { exact: true })).toBeVisible()
  await expect(lsp.getByText("typescript", { exact: true })).toBeVisible()
  await expect(lsp.getByText("rust", { exact: true })).toHaveCount(0)
  await expect(lsp.locator(".session-service-dot")).toHaveCount(0)
  await testInfo.attach("summary-configured-lsp", { body: await page.screenshot(), contentType: "image/png" })
})
