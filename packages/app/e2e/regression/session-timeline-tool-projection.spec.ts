import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("transitions shell and question through running error outcomes", async ({ page }) => {
  const shellID = "prt_transition_error_shell"
  const questionID = "prt_transition_error_question"
  const timeline = await setupTimeline(page, {
    settings: { shellToolPartsExpanded: true },
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
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(toolPart(shellID, "shell", "running", { command: "exit 1" })), 120)
  await timeline.send(partUpdated(toolPart(questionID, "question", "running", questionInput())), 180)
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(
    partUpdated(toolPart(shellID, "shell", "error", { command: "exit 1" }, { error: "Command exited 1" })),
    180,
  )
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "error", questionInput(), { error: "The user dismissed this question" }),
    ),
    250,
  )

  await expect(page.locator(`[data-timeline-part-id="${shellID}"] [data-kind="tool-error-card"]`)).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toContainText(/dismissed/i)
})

test("preserves surviving grouped patch state when its first patch fails", async ({ page }) => {
  const failed = "prt_grouped_patch_failed"
  const surviving = "prt_grouped_patch_surviving"
  const timeline = await setupTimeline(page, {
    settings: { editToolPartsExpanded: true },
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

  const group = page.locator(`[data-timeline-part-ids="${failed},${surviving}"]`)
  const file = group.locator('[data-scope="apply-patch"] button')
  await expect(file).toBeVisible()
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
  await expect(failedRow).toHaveAttribute("data-timeline-key", /^assistant-part:part:/)
  await expect(survivingRow).toHaveAttribute("data-timeline-key", /^assistant-part:file:/)
  await expect(failedRow.getByText("Patch failed visibly")).toBeVisible()
  await expect(survivingRow).toHaveAttribute("data-group-identity", "preserved")
  await expect(survivingRow.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
  await expect
    .poll(async () => {
      const previous = await failedRow.boundingBox()
      const next = await survivingRow.boundingBox()
      return previous && next ? next.y - (previous.y + previous.height) : Number.NEGATIVE_INFINITY
    })
    .toBeGreaterThanOrEqual(-0.5)
})

test("groups instruction files loaded by the same read", async ({ page }) => {
  const id = "prt_read_instructions"
  await setupTimeline(page, {
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
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

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
