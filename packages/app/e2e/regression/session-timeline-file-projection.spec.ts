import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode-ai/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import {
  assistantMessage,
  setupTimeline,
  toolPart,
  userMessage,
  userText,
} from "../performance/timeline-stability/fixture"

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
    settings: {
      timelineDetail: { ...timelinePresets[2].value, edit: { placement: "separate", details: "collapsed" } },
    },
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
  await setupTimeline(page, {
    settings: {
      timelineDetail: { ...timelinePresets[2].value, edit: { placement: "separate", details: "collapsed" } },
    },
    messages: [
      userMessage([userText("Preceding context ".repeat(120))]),
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
      ]),
    ],
    viewport: { width: 1200, height: 600 },
  })

  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const wrapper = page.locator(`[data-timeline-part-id="${id}"]`)
  const row = page.locator("[data-timeline-key]", { has: wrapper })
  const trigger = wrapper.getByRole("button")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const measured = element.querySelector<HTMLElement>("[data-index]")
        return measured
          ? Math.abs(element.getBoundingClientRect().height - measured.getBoundingClientRect().height)
          : Number.POSITIVE_INFINITY
      }),
    )
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(1)
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 0.25
  })
  await expect(trigger).toBeInViewport()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(0.5)
  const bottomScrollTop = await scroller.evaluate((element) => element.scrollTop)
  await scroller.hover()
  await page.mouse.wheel(0, -20)
  await expect
    .poll(() => scroller.evaluate((element, bottom) => bottom - element.scrollTop, bottomScrollTop))
    .toBeGreaterThan(0)
  const y = await trigger.evaluate((element) => element.getBoundingClientRect().y)
  const collapsedHeight = await row.evaluate((element) => element.getBoundingClientRect().height)
  await trigger.click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
  await expect
    .poll(() =>
      row.evaluate((element, collapsed) => {
        const measured = element.querySelector<HTMLElement>("[data-index]")
        const allocatedHeight = element.getBoundingClientRect().height
        return {
          grew: allocatedHeight > collapsed + 1,
          measured: measured ? Math.abs(allocatedHeight - measured.getBoundingClientRect().height) <= 1 : false,
        }
      }, collapsedHeight),
    )
    .toEqual({ grew: true, measured: true })
  await expect
    .poll(() => trigger.evaluate((element, initialY) => Math.abs(element.getBoundingClientRect().y - initialY), y))
    .toBeLessThanOrEqual(5)

  const scrollTop = await scroller.evaluate((element) => element.scrollTop)
  await scroller.hover()
  await page.mouse.wheel(0, 200)
  await expect
    .poll(() => scroller.evaluate((element, initial) => element.scrollTop - initial, scrollTop))
    .toBeGreaterThan(50)
  const scrolled = await scroller.evaluate((element, initial) => element.scrollTop - initial, scrollTop)
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
    .poll(() =>
      row.evaluate((element) => {
        const measured = element.querySelector<HTMLElement>("[data-index]")
        return measured
          ? Math.abs(element.getBoundingClientRect().height - measured.getBoundingClientRect().height)
          : Number.POSITIVE_INFINITY
      }),
    )
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
})
