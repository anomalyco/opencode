import { expect, story } from "../../storybook/playwright/story"

const id = "current-session-tool-headers--shared-headers"

story("shares compact title and detail metrics across tool families", async ({ mount }, info) => {
  const root = await mount(id)
  await root.getByRole("button", { name: /^Used 7 / }).click()
  const headers = root.locator('[data-component="context-tool-group-list"] [data-component="tool-header"]')
  await expect(headers).toHaveCount(7)
  const titles = headers.locator('[data-slot="basic-tool-tool-title"]')
  await expect(headers.locator('[data-component="text-shimmer"][aria-label="Write"]')).toBeVisible()
  await expect(headers.locator('[data-component="text-shimmer"][aria-label="Edit"]')).toBeVisible()
  for (const title of await titles.all()) {
    await expect(title).toBeVisible()
    await expect(title).toHaveCSS("font-family", /^Inter,/)
    await expect(title).toHaveCSS("font-size", "13px")
    await expect(title).toHaveCSS("line-height", "16px")
    await expect(title).toHaveCSS("font-weight", "530")
    await expect(title.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "false")
  }
  const details = headers.locator(
    '[data-slot="basic-tool-tool-subtitle"], [data-slot="basic-tool-tool-arg"], [data-slot="tool-header-directory"]',
  )
  expect(await details.count()).toBeGreaterThan(7)
  for (const detail of await details.all()) {
    await expect(detail).toHaveCSS("font-size", "13px")
    await expect(detail).toHaveCSS("line-height", "16px")
    await expect(detail).toHaveCSS("font-weight", "440")
  }
  await expect(headers.locator('[data-slot="basic-tool-tool-arg"]')).toHaveText([
    "offset=12",
    "limit=40",
    "pattern=header",
    "include=*.tsx",
  ])
  await root.locator('[data-component="session-timeline"]').screenshot({ path: info.outputPath("tool-headers.png") })
})

story("keeps pending file titles active without showing unfinished paths", async ({ mount }) => {
  const root = await mount(id, { args: { phase: "streaming", pathKnown: false } })
  await root
    .locator(
      '[data-component="collapsed-tool-group"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
    )
    .click()
  for (const action of [undefined, "Provide paths", "Run tools"]) {
    if (action) await root.getByRole("button", { name: action, exact: true }).click()
    for (const name of ["edit", "write"]) {
      const header = root.locator(`[data-timeline-part-id="tool_header_${name}"] [data-component="tool-header"]`)
      await expect(header).toBeVisible()
      await expect(header.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
      await expect(header.locator('[data-slot="basic-tool-tool-title"]')).toHaveCSS("line-height", "16px")
      await expect(
        header.locator('[data-slot="basic-tool-tool-subtitle"], [data-slot="tool-header-directory"]'),
      ).toHaveCount(0)
    }
  }
  await root.getByRole("button", { name: "Complete tools", exact: true }).click()
  const group = root.getByRole("button", { name: /^Used 7 / })
  if ((await group.getAttribute("aria-expanded")) === "false") await group.click()
  for (const name of ["edit", "write"]) {
    const header = root.locator(`[data-timeline-part-id="tool_header_${name}"] [data-component="tool-header"]`)
    await expect(header.locator('[data-slot="basic-tool-tool-subtitle"]')).toHaveText(`${name}.ts`)
    await expect(header.locator('[data-slot="tool-header-directory"]')).toContainText("src/components")
    await expect(header.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "false")
  }
})

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1000]) {
    story(`truncates long file headers at ${width}px in ${theme}`, async ({ mount, page }, info) => {
      await page.setViewportSize({ width, height: 850 })
      const root = await mount(id, { args: { longPath: true }, globals: { theme } })
      await root.getByRole("button", { name: /^Used 7 / }).click()
      for (const name of ["edit", "write"]) {
        const header = root.locator(`[data-timeline-part-id="tool_header_${name}"] [data-component="tool-header"]`)
        const filename = header.locator('[data-slot="basic-tool-tool-subtitle"]')
        const directory = header.locator('[data-slot="tool-header-directory"] > span')
        await expect(filename).toContainText(`${name}.ts`)
        for (const text of [filename, directory]) {
          await expect(text).toHaveCSS("text-overflow", "ellipsis")
          await expect(text).toHaveCSS("white-space", "nowrap")
          await expect(text).toHaveCSS("line-height", "16px")
        }
        expect(await filename.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
        const bounds = await header.boundingBox()
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await root
        .locator('[data-component="session-timeline"]')
        .screenshot({ path: info.outputPath("long-headers.png") })
    })
  }
}

story("preserves keyboard disclosures and the webfetch link", async ({ mount }) => {
  const root = await mount(id)
  await root.getByRole("button", { name: /^Used 7 / }).click()
  for (const name of ["shell", "execute", "edit", "write"]) {
    const row = root.locator(`[data-timeline-part-id="tool_header_${name}"]`)
    const trigger = row.locator('[data-slot="collapsible-trigger"]').first()
    const content = row.locator('[data-slot="collapsible-content"]').first()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await trigger.focus()
    await trigger.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(content).toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.press("Space")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(content).toBeHidden()
    await expect(trigger).toBeFocused()
  }
  const link = root.getByRole("link", { name: "https://example.com/docs" })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute("href", "https://example.com/docs")
  await expect(link).toHaveAttribute("target", "_blank")
  await expect(link).toHaveAttribute("rel", /noopener/)
  await expect(link).toHaveCSS("font-size", "13px")
  await expect(link).toHaveCSS("font-weight", "440")
  await expect(link).toHaveCSS("line-height", "16px")
  await expect(link).toHaveCSS("letter-spacing", "-0.04px")
  await link.focus()
  await expect(link).toBeFocused()
})
