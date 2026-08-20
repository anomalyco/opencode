import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

test("preserves nested patch file state through outer collapse and reopen", async ({ page }) => {
  const patchID = "prt_nested_patch"
  const files = [patchFile("src/a.ts", "update"), patchFile("src/b.ts", "add"), patchFile("src/old.ts", "delete")]
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          patchID,
          "apply_patch",
          "completed",
          { files: files.map((file) => file.filePath) },
          { metadata: { files } },
        ),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })
  const wrapper = page.locator(`[data-timeline-part-id="${patchID}"]`)
  const outer = wrapper.locator('[data-slot="collapsible-trigger"]').first()
  const deleted = wrapper.locator('[data-scope="apply-patch"] [data-type="delete"]')
  await deleted.getByRole("button").click()
  await expect(deleted.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await outer.click()
  await expect(outer).toHaveAttribute("aria-expanded", "false")
  await outer.click()
  await expect(outer).toHaveAttribute("aria-expanded", "true")
  await expect(deleted.getByRole("button")).toHaveAttribute("aria-expanded", "true")
})

function patchFile(filePath: string, type: "add" | "update" | "delete") {
  return {
    filePath,
    relativePath: filePath,
    type,
    additions: type === "delete" ? 0 : 4,
    deletions: type === "add" ? 0 : 3,
    before: type === "add" ? undefined : source(false),
    after: type === "delete" ? undefined : source(true),
  }
}

function source(changed: boolean) {
  return Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join(
    "",
  )
}
