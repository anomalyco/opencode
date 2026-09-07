import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode-ai/session-ui/timeline/detail"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("keeps shell and question failures in their Used group", async ({ page }) => {
  const shellID = "prt_transition_error_shell"
  const questionID = "prt_transition_error_question"
  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(shellID, "shell", "streaming", { command: "exit 1" }),
          toolPart(questionID, "question", "streaming", questionInput()),
        ],
        { completed: false },
      ),
    ],
  })
  const group = page.locator('[data-component="collapsed-tool-group"]')
  const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await used.click()
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(toolPart(shellID, "shell", "running", { command: "exit 1" })))
  await expect(page.locator(`[data-timeline-part-id="${shellID}"]`)).toContainText("exit 1")
  await timeline.send(partUpdated(toolPart(questionID, "question", "running", questionInput())))
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(
    partUpdated(
      toolPart(
        shellID,
        "shell",
        "completed",
        { command: "exit 1" },
        { output: "Command exited 1", metadata: { exit: 1 } },
      ),
    ),
  )
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "error", questionInput(), { error: "The user dismissed this question" }),
    ),
  )

  await expect(group).toHaveAttribute("data-timeline-part-ids", `${shellID},${questionID}`)
  await expect(used).toHaveAttribute("aria-expanded", "true")
  const shell = group.locator(`[data-timeline-part-id="${shellID}"]`)
  await expect(shell.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
  await shell.locator('[data-slot="collapsible-trigger"]').click()
  await expect(shell).toContainText("Command exited 1")
  const question = group.locator(`[data-timeline-part-id="${questionID}"]`)
  await expect(question).toContainText(/dismissed/i)
})

test("keeps a failed patch in Used without losing the surviving file choice", async ({ page }) => {
  const failed = "prt_grouped_patch_failed"
  const surviving = "prt_grouped_patch_surviving"
  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(failed, "patch", "running", { patchText: "Update src/failed.ts" }),
          toolPart(
            surviving,
            "patch",
            "running",
            { patchText: "Update src/surviving.ts" },
            {
              metadata: {
                files: [
                  {
                    file: "src/surviving.ts",
                    status: "modified",
                    patch: "@@ -1 +1 @@\n-export const value = 1\n+export const value = 2",
                    additions: 1,
                    deletions: 1,
                  },
                ],
              },
            },
          ),
        ],
        { completed: false },
      ),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await used.click()
  const file = group.locator('[data-scope="apply-patch"] button')
  await expect(file).toBeVisible()
  await expect(file).toHaveAttribute("aria-expanded", "false")
  await file.click()
  await expect(file).toHaveAttribute("aria-expanded", "true")
  await group.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")
    if (row) row.dataset.groupIdentity = "preserved"
  })

  await timeline.send(
    partUpdated(
      toolPart(failed, "patch", "error", { patchText: "Update src/failed.ts" }, { error: "Patch failed visibly" }),
    ),
  )

  const failedRow = page.locator("[data-timeline-key]", {
    has: page.locator(`[data-timeline-part-id="${failed}"]`),
  })
  const survivingRow = page.locator("[data-timeline-key]", {
    has: page.locator(`[data-timeline-part-id="${surviving}"]`),
  })
  await expect(group).toHaveAttribute("data-timeline-part-ids", `${failed},${surviving}`)
  await expect(used).toHaveAttribute("aria-expanded", "true")
  await expect(failedRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await expect(survivingRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await group.locator(`[data-timeline-part-id="${failed}"] [data-slot="collapsible-trigger"]`).click()
  await expect(failedRow.getByText("Patch failed visibly")).toBeVisible()
  await expect(survivingRow).toHaveAttribute("data-group-identity", "preserved")
  await expect(survivingRow.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
})

test("groups instruction files loaded by the same read", async ({ page }) => {
  const id = "prt_read_instructions"
  await setupTimeline(page, {
    settings: { timelineDetail: { ...timelinePresets[2].value, tools: { placement: "separate" } } },
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          id,
          "read",
          "completed",
          { path: "src/a.ts" },
          { metadata: { loaded: ["AGENTS.md", "packages/app/AGENTS.md", "packages/ui/AGENTS.md"] } },
        ),
      ]),
    ],
  })

  const tool = page.locator(`[data-timeline-part-id="${id}"]`)
  const loaded = tool.locator('[data-component="tool-loaded-item"]')
  await expect(loaded).toHaveCount(1)
  await expect(loaded).toHaveAttribute("aria-label", "Loaded AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md")
  await expect(loaded.locator('[data-slot="tool-loaded-value"]')).toHaveText(
    "AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md",
  )
  await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveCount(0)
})

test("groups only consecutive successful skill tools", async ({ page }) => {
  const parts = [
    toolPart("prt_skill_first", "skill", "completed", { id: "ocpr" }),
    toolPart("prt_skill_second", "skill", "completed", { id: "effect" }),
    toolPart("prt_skill_third", "skill", "completed", { id: "ui-pr-screenshots" }),
    toolPart("prt_skill_break", "read", "completed", { path: "src/a.ts" }),
    toolPart("prt_skill_last", "skill", "completed", { id: "opencode" }),
  ]
  await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [userMessage(), assistantMessage(parts)],
  })

  const group = page.locator(`[data-timeline-part-ids="${parts.map((part) => part.id).join(",")}"]`)
  await group.getByRole("button").click()

  const loaded = group.locator('[data-component="tool-loaded-item"]')
  await expect(loaded).toHaveCount(2)
  await expect(loaded.nth(0)).toHaveAttribute("aria-label", "Loaded ocpr, effect, ui-pr-screenshots skills")
  await expect(loaded.nth(1)).toHaveAttribute("aria-label", "Loaded opencode skill")
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}
