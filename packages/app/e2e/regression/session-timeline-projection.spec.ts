import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  status,
  toolPart,
  userMessage,
  userText,
} from "../performance/timeline-stability/fixture"

test.describe("session timeline projection", () => {
  test("combines adjacent patch calls and repeated files into one group", async ({ page }) => {
    const first = "prt_patch_first"
    const second = "prt_patch_second"
    const timeline = await setupTimeline(page, {
      settings: { editToolPartsExpanded: true },
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            first,
            "patch",
            "completed",
            { patchText: "Update src/first.ts" },
            {
              metadata: { files: [patchFile("src/first.ts", "modified")] },
            },
          ),
        ]),
      ],
    })

    const initial = page.locator(`[data-timeline-part-id="${first}"]`)
    const initialFile = initial.locator('[data-scope="apply-patch"] [data-type="update"]')
    await expect(initialFile).toBeVisible()
    await initialFile.getByRole("button").click()
    await expect(initialFile.getByRole("button")).toHaveAttribute("aria-expanded", "true")
    await initial.evaluate((element) => {
      const row = element.closest<HTMLElement>("[data-timeline-key]")
      if (row) row.dataset.patchRow = "stable"
    })

    await timeline.send(
      partUpdated(toolPart(second, "patch", "running", { patchText: "Update more files" }, { metadata: {} })),
    )

    const group = page.locator(`[data-timeline-part-ids="${first},${second}"]`)
    await expect(group.locator("xpath=ancestor::*[@data-timeline-key]")).toHaveAttribute("data-patch-row", "stable")
    await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
    await expect(group.locator('[data-scope="apply-patch"] [data-type="update"] button')).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    await timeline.send(
      partUpdated(
        toolPart(
          second,
          "patch",
          "completed",
          { patchText: "Update more files" },
          {
            metadata: {
              files: [patchFile("src/first.ts", "modified"), patchFile("src/second.ts", "added")],
            },
          },
        ),
      ),
    )

    await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts", "second.ts"])
    await expect(group.locator('[data-scope="apply-patch"] [data-type="update"] button')).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    await expect(group.locator('[data-scope="apply-patch"] [data-type="add"] button')).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(page.locator(`[data-timeline-part-id="${first}"], [data-timeline-part-id="${second}"]`)).toHaveCount(0)
  })

  test("projects gaps, dividers, assistant parts, and errors together", async ({ page }) => {
    const firstUser = userMessage(
      [
        userText("Keep this stable", { id: "prt_comment" }),
        userText("Continue after the comment", { id: "prt_visible_user" }),
      ],
      { summary: { diffs: Array.from({ length: 11 }, (_, index) => summaryDiff(index)) } },
    )
    const aborted = assistantMessage([{ id: "prt_before_abort", type: "text", text: "Before interruption" }], {
      id: "msg_1001_assistant_aborted",
      error: { type: "MessageAbortedError", message: "Stopped" },
    })
    const failed = assistantMessage([{ id: "prt_after_abort", type: "text", text: "After interruption" }], {
      id: "msg_1002_assistant_failed",
      error: {
        type: "APIError",
        message: "Visible provider failure",
      },
      created: 1700000003000,
    })
    const nextUser = userMessage([userText("Second turn", { id: "prt_second_user" })], {
      id: "msg_2000_second_user",
      created: 1700000005000,
    })
    const nextAssistant = assistantMessage([{ id: "prt_second_text", type: "text", text: "Second response" }], {
      id: "msg_2001_second_assistant",
      parentID: "msg_2000_second_user",
      created: 1700000006000,
    })
    const timeline = await setupTimeline(page, { messages: [firstUser, aborted, failed, nextUser, nextAssistant] })
    await timeline.send(status("idle"), 100)
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = 0))

    await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
    await expect(page.getByText("Before interruption", { exact: true })).toBeVisible()
    await expect(page.getByText("Visible provider failure")).toBeVisible()
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()
  })

  test("renders aliased and long custom model notices", async ({ page }) => {
    const shortName = "GPT-5.4 nano"
    const longName = "Company Gateway Extra Long Context Model for Narrow Timeline Layouts"
    await setupTimeline(page, {
      viewport: { width: 420, height: 700 },
      sessionMessages: [
        {
          id: "msg_model_fast_nano",
          type: "model-switched",
          time: { created: 1700000000000 },
          model: { providerID: "company-gateway", id: "fast-nano", variant: "xhigh" },
        },
        {
          id: "msg_model_long_context",
          type: "model-switched",
          time: { created: 1700000001000 },
          model: { providerID: "company-gateway", id: "long-context" },
        },
        userMessage(),
        assistantMessage(),
      ],
    })

    const shortNotice = page.locator('[data-slot="session-timeline-notice"]').filter({ hasText: shortName })
    const longNotice = page.locator('[data-slot="session-timeline-notice"]').filter({ hasText: longName })
    await expect(shortNotice).toBeVisible()
    await expect(shortNotice.getByText(`Switched to ${shortName}`, { exact: true })).toBeVisible()
    await expect(shortNotice.locator('[data-slot="session-timeline-notice-variant"]')).toHaveText("xhigh")
    await expect(page.getByText("fast-nano", { exact: true })).toHaveCount(0)
    await expect(shortNotice.locator('[data-component="provider-icon"]')).toBeVisible()
    await expect(longNotice).toBeVisible()
    await expect(longNotice.locator('[data-component="provider-icon"]')).toBeVisible()
    await expect(longNotice.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
    await expect(longNotice.locator("[title]")).toHaveAttribute("title", `Switched to ${longName}`)
    await expect.poll(() => longNotice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
})

function patchFile(file: string, status: "added" | "modified" | "deleted") {
  return {
    file,
    status,
    patch:
      status === "added"
        ? "@@ -0,0 +1 @@\n+export const after = true"
        : status === "deleted"
          ? "@@ -1 +0,0 @@\n-export const before = true"
          : "@@ -1 +1 @@\n-export const before = true\n+export const after = true",
    additions: status === "deleted" ? 0 : 1,
    deletions: status === "added" ? 0 : 1,
  }
}

function summaryDiff(index: number) {
  return {
    file: `src/diff-${index}.ts`,
    additions: 1,
    deletions: 1,
    status: "modified" as const,
    patch: `@@ -1 +1 @@\n-export const value = ${index}\n+export const value = ${index + 1}`,
  }
}
