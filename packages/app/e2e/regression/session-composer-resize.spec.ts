import { expect, test } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

test("Context panel can be resized with split diffs selected and the composer stays within its card", async ({
  page,
}) => {
  await setupTimeline(page, { viewport: { width: 1300, height: 900 }, settings: { newLayoutDesigns: true } })
  await page.route(/\/provider(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: {
              "claude-opus-4-6": {
                id: "claude-opus-4-6",
                name: "Gemma 4 12B QAT Local with extended context",
                limit: { context: 200_000 },
                variants: { high: {} },
              },
            },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "claude-opus-4-6" },
      },
    }),
  )
  await page.reload()
  await page.getByRole("button", { name: "View context usage", exact: true }).click()
  const handle = page.getByTestId("session-panel-resize")
  await expect(handle).toBeVisible()
  const initial = (await handle.boundingBox())!
  await page.mouse.move(initial.x + initial.width / 2, initial.y + 180)
  await page.mouse.down()
  await page.mouse.move(initial.x + initial.width / 2 + 120, initial.y + 180, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await handle.boundingBox())!.x).toBeGreaterThan(initial.x + 90)

  const expanded = (await handle.boundingBox())!
  const model = page.locator('[data-action="prompt-model"]')
  await expect(model).toContainText("Gemma 4 12B QAT Local with extended context")
  await expect(page.getByRole("button", { name: "Choose model variant", exact: true })).toBeVisible()
  await page.reload()
  await expect(handle).toBeVisible()
  await expect.poll(async () => Math.abs((await handle.boundingBox())!.x - expanded.x)).toBeLessThan(2)
  const restored = (await handle.boundingBox())!
  await page.mouse.move(restored.x + restored.width / 2, restored.y + 180)
  await page.mouse.down()
  await page.mouse.move(restored.x - 500, restored.y + 180, { steps: 16 })
  await page.mouse.up()

  const composer = page.locator('[data-component="prompt-input-v2"]')
  const settings = composer.locator('[data-slot="prompt-settings"]')
  const add = composer.locator('[data-slot="prompt-add"]')
  await expect
    .poll(async () => {
      const top = (await settings.boundingBox())!
      const bottom = (await add.boundingBox())!
      return bottom.y - (top.y + top.height)
    })
    .toBeGreaterThanOrEqual(0)
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return [...element.querySelectorAll('[data-slot="prompt-footer"] button')].every((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width === 0 || (rect.left >= bounds.left && rect.right <= bounds.right)
        })
      }),
    )
    .toBe(true)
  const microphone = (await page.getByRole("button", { name: "Record audio", exact: true }).boundingBox())!
  const send = (await composer.locator('[data-action="prompt-submit"]').boundingBox())!
  expect(microphone.x + microphone.width).toBeLessThanOrEqual(send.x)
  await expect
    .poll(() =>
      composer.evaluate((element) => {
        const boxes = [...element.querySelectorAll('[data-slot="prompt-footer"] button')]
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width > 0)
        return boxes.every((box, index) =>
          boxes
            .slice(index + 1)
            .every(
              (other) =>
                Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 0 ||
                Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 0,
            ),
        )
      }),
    )
    .toBe(true)
  await page.screenshot({ path: test.info().outputPath("context-narrow-composer.png") })
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(handle).toHaveCount(0)
})
