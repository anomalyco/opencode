import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  status,
  toolPart,
  userMessage,
  userText,
  type PartSeed,
} from "../performance/timeline-stability/fixture"

test.describe("session timeline projection", () => {
  test("renders every admitted tool family and hides timeline-only exclusions", async ({ page }) => {
    const parts = [
      toolPart("prt_01_read", "read", "completed", { path: "src/a.ts" }),
      toolPart("prt_02_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
      toolPart("prt_03_grep", "grep", "completed", { path: ".", pattern: "value" }),
      toolPart("prt_04_list", "list", "completed", { path: "src" }),
      toolPart("prt_webfetch", "webfetch", "completed", { url: "https://example.com" }),
      toolPart(
        "prt_websearch",
        "websearch",
        "completed",
        { query: "timeline stability" },
        { output: "https://example.com/result" },
      ),
      toolPart("prt_task", "subagent", "completed", {
        description: "Inspect timeline",
        agent: "explore",
        prompt: "Inspect the timeline implementation.",
      }),
      toolPart(
        "prt_bash",
        "shell",
        "completed",
        { command: "printf stable" },
        { output: "stable", title: "printf stable" },
      ),
      editPart("prt_edit"),
      toolPart("prt_write", "write", "completed", { path: "src/new.ts", content: "export const stable = true\n" }),
      patchPart("prt_patch"),
      toolPart("prt_todo", "todowrite", "completed", { todos: [{ content: "Hidden", status: "pending" }] }),
      toolPart(
        "prt_question",
        "question",
        "completed",
        { questions: [{ question: "Keep stable?", header: "Stability", options: [] }] },
        { metadata: { answers: [["Yes"]] } },
      ),
      toolPart("prt_skill", "skill", "completed", { name: "stability" }),
      toolPart("prt_custom", "custom_mcp_tool", "completed", { target: "timeline", count: 2 }),
    ]
    await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

    await expect(
      page.locator('[data-timeline-part-ids="prt_01_read,prt_02_glob,prt_03_grep,prt_04_list"]'),
    ).toBeVisible()
    for (const id of [
      "prt_webfetch",
      "prt_websearch",
      "prt_task",
      "prt_bash",
      "prt_edit",
      "prt_write",
      "prt_patch",
      "prt_question",
      "prt_skill",
      "prt_custom",
    ]) {
      await expect(page.locator(`[data-timeline-part-id="${id}"]`).first(), id).toBeVisible()
    }
    const patch = page.locator('[data-timeline-part-id="prt_patch"]')
    await expect(patch.getByText("1 file", { exact: true })).toBeVisible()
    await expect(patch.getByRole("button", { name: "Patch 1 file", exact: true })).toHaveCount(0)
    await expect(patch.getByRole("button")).toHaveCount(1)
    await expect(patch.locator('[data-scope="apply-patch"] button[aria-expanded="false"]')).toHaveCount(1)
    await expect(patch.locator('[data-slot="message-part-title-filename"]')).toHaveCount(0)
    await expect(patch.locator('[data-slot="message-part-actions"]')).toHaveCount(0)
    const edit = page.locator('[data-timeline-part-id="prt_edit"]')
    await expect(edit.locator('[data-component="apply-patch-tool"]')).toBeVisible()
    await expect(edit.locator('[data-slot="basic-tool-tool-title"]')).toContainText("Edit")
    await expect(page.locator('[data-timeline-part-id="prt_todo"]')).toHaveCount(0)
  })

  test("combines adjacent patch calls and repeated files into one group", async ({ page }) => {
    const first = "prt_patch_first"
    const second = "prt_patch_second"
    const timeline = await setupTimeline(page, {
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

  test("combines adjacent edit calls and repeated files into one group", async ({ page }) => {
    const first = "prt_edit_first"
    const second = "prt_edit_second"
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            first,
            "edit",
            "completed",
            { path: "src/first.ts", oldString: "one", newString: "two" },
            {
              metadata: { files: [patchFile("src/first.ts", "modified")] },
            },
          ),
          toolPart(
            second,
            "edit",
            "completed",
            { path: "src/first.ts", oldString: "two", newString: "three" },
            {
              metadata: { files: [patchFile("src/first.ts", "modified")] },
            },
          ),
        ]),
      ],
      settings: { editToolPartsExpanded: true },
    })

    const group = page.locator(`[data-timeline-part-ids="${first},${second}"]`)
    await expect(group.locator('[data-slot="basic-tool-tool-title"]')).toContainText("Edit")
    await expect(group.getByText("1 file", { exact: true })).toBeVisible()
    await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
    await expect(group.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
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

  test("renders interruption independently when the turn is not compacted", async ({ page }) => {
    const user = userMessage()
    const before = assistantMessage([{ id: "prt_before", type: "text", text: "Before" }], {
      id: "msg_1001_before",
      error: { type: "MessageAbortedError", message: "Stopped" },
    })
    const after = assistantMessage([{ id: "prt_after", type: "text", text: "After" }], {
      id: "msg_1002_after",
      created: 1700000003000,
    })
    await setupTimeline(page, { messages: [user, before, after] })

    await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
    const rows = await page
      .locator('[data-timeline-row="AssistantPart"], [data-timeline-row="TurnDivider"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))
    expect(rows).toEqual(["AssistantPart", "TurnDivider", "AssistantPart"])
  })

  test("renders user image, file attachment, file reference, and agent reference", async ({ page }) => {
    const text = "Use @explore with @src/a.ts and inspect the attachments"
    const parts: PartSeed<"user">[] = [
      userText(text, { id: "prt_user_rich" }),
      {
        id: "prt_user_image",
        type: "file",
        mime: "image/png",
        filename: "pixel.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      {
        id: "prt_user_attachment",
        type: "file",
        mime: "application/json",
        filename: "tsconfig.json",
        url: "data:application/json;base64,e30=",
      },
      {
        id: "prt_user_reference",
        type: "file",
        mime: "text/plain",
        filename: "a.ts",
        url: "src/a.ts",
        source: { type: "file", path: "src/a.ts", text: { value: "@src/a.ts", start: 18, end: 27 } },
      },
      {
        id: "prt_user_agent",
        type: "agent",
        name: "explore",
        source: { value: "@explore", start: 4, end: 12 },
      },
    ]
    await setupTimeline(page, { messages: [userMessage(parts), assistantMessage()] })

    await expect(page.getByAltText("pixel.png")).toBeVisible()
    await expect(page.getByText("tsconfig.json")).toBeVisible()
    await expect(page.getByText("@src/a.ts", { exact: true })).toBeVisible()
    await expect(page.getByText("@explore", { exact: true })).toBeVisible()
  })
})

function editPart(id: string) {
  return toolPart(
    id,
    "edit",
    "completed",
    { path: "src/a.ts", oldString: "export const value = 1", newString: "export const value = 2" },
    {
      metadata: {
        files: [patchFile("src/a.ts", "modified")],
      },
    },
  )
}

function patchPart(id: string) {
  return toolPart(
    id,
    "patch",
    "completed",
    { patchText: "Update the projected files" },
    {
      metadata: {
        files: [patchFile("src/a.ts", "modified")],
      },
    },
  )
}

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
