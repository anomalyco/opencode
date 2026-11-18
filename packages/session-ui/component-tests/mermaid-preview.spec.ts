import { expect, story } from "../../stories/playwright/story"

story("maximizes a Mermaid diagram to zoom into and move around", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  const root = await mount("current-session-mermaid--state-graph")
  const inline = root.locator('[data-component="markdown-mermaid"] > svg')
  await expect(inline).toContainText("Boundary")
  await root.locator('[data-component="markdown-code"]').hover()
  await root.getByRole("button", { name: "Maximize diagram" }).click()

  const preview = page.locator('[data-component="diagram-preview"]')
  const diagram = preview.locator('[data-slot="diagram-preview-canvas"] > svg')
  const level = preview.locator('[data-slot="diagram-preview-zoom-level"]')
  await expect(diagram).toContainText("Boundary")
  expect((await diagram.boundingBox())!.width).toBeGreaterThan((await inline.boundingBox())!.width)
  const fit = (await level.textContent())!

  await preview.getByRole("button", { name: "Zoom in" }).click()
  await expect(level).not.toHaveText(fit)
  await expect(preview.locator('[data-slot="diagram-preview-body"]')).toHaveAttribute("data-zoomed", "")

  // An arrow key moves the view right, so the diagram moves left.
  const x = (await diagram.boundingBox())!.x
  await page.keyboard.press("ArrowRight")
  await expect.poll(async () => (await diagram.boundingBox())!.x).toBeLessThan(x - 10)

  // The first Escape zooms back to fit, the second closes, and the diagram is still in the message.
  await page.keyboard.press("Escape")
  await expect(level).toHaveText(fit)
  await page.keyboard.press("Escape")
  await expect(preview).toHaveCount(0)
  await expect(inline).toBeVisible()
})

story("opens a small diagram at its drawn size", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  const root = await mount("current-session-mermaid--diagrams")
  await root.locator('[data-component="markdown-code"]').first().hover()
  await root.getByRole("button", { name: "Maximize diagram" }).first().click()
  const preview = page.locator('[data-component="diagram-preview"]')
  await expect(preview.locator('[data-slot="diagram-preview-canvas"] > svg')).toContainText("Client")
  await expect(preview.locator('[data-slot="diagram-preview-zoom-level"]')).toHaveText("100%")
})
