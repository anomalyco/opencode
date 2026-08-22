import { expect, test } from "@playwright/test"
import { createTwoFilesPatch } from "diff"
import {
  assistantMessage,
  setupTimeline,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("renders completed write content", async ({ page }) => {
  const id = "prt_file_projection_write"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(id, "write", "completed", { path: "src/write.ts", content: "export const written = true\n" }),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  await expect(page.locator(`[data-timeline-part-id="${id}"] [data-component="write-content"]`)).toBeVisible()
})

test("renders a completed single-file patch", async ({ page }) => {
  const id = "prt_file_projection_single_patch"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          id,
          "patch",
          "completed",
          { patchText: "Update src/a.ts" },
          {
            metadata: {
              files: [
                {
                  file: "src/a.ts",
                  status: "modified",
                  patch:
                    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-export const value = 1\n+export const value = 2\n",
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          },
        ),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })

  const wrapper = page.locator(`[data-timeline-part-id="${id}"]`)
  const file = wrapper.locator('[data-scope="apply-patch"]')
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await expect(file.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toHaveCount(0)
  await file.getByRole("button").click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)

  await file.getByRole("button").click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toHaveCount(0)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)

  await file.getByRole("button").click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
})

test("keeps an expanded file diff header at the same viewport position", async ({ page }) => {
  const id = "prt_file_projection_anchored_patch"
  const before = Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}\n`).join("")
  const after = before.replaceAll(" = ", " = compute(").replaceAll("\n", ")\n")
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          id,
          "patch",
          "completed",
          { patchText: "Update src/anchored.ts" },
          {
            metadata: {
              files: [
                {
                  file: "src/anchored.ts",
                  status: "modified",
                  patch: createTwoFilesPatch("a/src/anchored.ts", "b/src/anchored.ts", before, after),
                  additions: 80,
                  deletions: 80,
                },
              ],
            },
          },
        ),
        textPart("prt_after_anchored_patch", "The diff is ready.\n\n".repeat(4)),
      ]),
    ],
    viewport: { width: 1200, height: 600 },
  })

  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const wrapper = page.locator(`[data-timeline-part-id="${id}"]`)
  const trigger = wrapper.getByRole("button")
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 0.25
  })
  await expect(trigger).toBeInViewport()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(0.5)
  await trigger.dispatchEvent("wheel", { deltaY: -1, deltaMode: 0 })
  await trigger.dispatchEvent("pointerdown")
  const y = await trigger.evaluate((element) => element.getBoundingClientRect().y)
  await trigger.dispatchEvent("click")
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
  await expect
    .poll(() => trigger.evaluate((element, initialY) => Math.abs(element.getBoundingClientRect().y - initialY), y))
    .toBeLessThanOrEqual(5)

  const scrollTop = await scroller.evaluate((element) => element.scrollTop)
  await scroller.hover()
  await page.mouse.wheel(0, 200)
  await timeline.settle(40)
  const scrolled = await scroller.evaluate((element, initial) => element.scrollTop - initial, scrollTop)
  expect(scrolled).toBeGreaterThan(50)
  expect(scrolled).toBeLessThan(400)

  const expandedY = await trigger.evaluate((element) => element.getBoundingClientRect().y)
  await trigger.click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toHaveCount(0)
  await expect
    .poll(() =>
      scroller.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
    )
    .toBeLessThanOrEqual(1)
  await expect.poll(() => trigger.evaluate((element) => element.getBoundingClientRect().y)).toBeGreaterThan(expandedY)

  await trigger.click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
})
