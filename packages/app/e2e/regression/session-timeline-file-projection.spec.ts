import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

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
  await expect(file.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toHaveCount(0)
  await file.getByRole("button").click()
  await expect(wrapper.locator('[data-component="apply-patch-file-diff"]')).toBeVisible()
})
