import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"
import { createTwoFilesPatch } from "diff"

test("keeps patch file disclosures independent", async ({ page }) => {
  const patchID = "prt_nested_patch"
  const files = [patchFile("src/a.ts", "modified"), patchFile("src/b.ts", "added"), patchFile("src/old.ts", "deleted")]
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          patchID,
          "patch",
          "completed",
          { patchText: "Update three files" },
          { metadata: { files } },
        ),
      ]),
    ],
    settings: { editToolPartsExpanded: true },
  })
  const wrapper = page.locator(`[data-timeline-part-id="${patchID}"]`)
  const modified = wrapper.locator('[data-scope="apply-patch"] [data-type="update"]')
  const deleted = wrapper.locator('[data-scope="apply-patch"] [data-type="delete"]')
  await expect(wrapper.locator('[data-scope="apply-patch"] [aria-expanded="false"]')).toHaveCount(3)
  await deleted.getByRole("button").click()
  await expect(deleted.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await expect(modified.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await modified.getByRole("button").click()
  await expect(modified.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await deleted.getByRole("button").click()
  await expect(deleted.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await expect(modified.getByRole("button")).toHaveAttribute("aria-expanded", "true")
})

function patchFile(file: string, status: "added" | "modified" | "deleted") {
  const before = status === "added" ? "" : source(false)
  const after = status === "deleted" ? "" : source(true)
  return {
    file,
    status,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
    additions: status === "deleted" ? 0 : 4,
    deletions: status === "added" ? 0 : 3,
  }
}

function source(changed: boolean) {
  return Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join(
    "",
  )
}
