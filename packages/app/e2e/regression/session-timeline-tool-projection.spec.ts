import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("renders every tool error outcome without leaking hidden tools", async ({ page }) => {
  const ordinary = ["shell", "edit", "write", "patch", "webfetch", "websearch", "subagent", "skill", "mcp_probe"]
  const parts = ordinary.map((tool, index) =>
    toolPart(`prt_error_${index}`, tool, "error", errorInput(tool), { error: `${tool} failed visibly` }),
  )
  parts.push(
    toolPart("prt_question_dismissed", "question", "error", questionInput(), {
      error: "The user dismissed this question",
    }),
    toolPart("prt_question_error", "question", "error", questionInput(), { error: "Question transport failed" }),
    toolPart("prt_todo_error", "todowrite", "error", { todos: [] }, { error: "Hidden todo failure" }),
  )
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const group = page.locator(`[data-timeline-part-ids="${ordinary.map((_, index) => `prt_error_${index}`).join(",")}"]`)
  await expect(group.locator('[data-component="tag"]')).toHaveText(String(ordinary.length))
  await group.getByRole("button").click()
  await expect(page.locator('[data-kind="tool-error-card"]')).toHaveCount(ordinary.length + 1)
  await expect(page.getByText(/dismissed/i)).toBeVisible()
  await expect(page.locator('[data-timeline-part-id="prt_todo_error"]')).toHaveCount(0)
  for (let index = 0; index < ordinary.length; index++) {
    await expect(page.locator(`[data-timeline-part-id="prt_error_${index}"]`)).toBeVisible()
  }
})

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

test("labels all web search provider variants", async ({ page }) => {
  const parts = [
    toolPart(
      "prt_search_parallel",
      "websearch",
      "completed",
      { query: "parallel" },
      { metadata: { provider: "parallel" } },
    ),
    toolPart("prt_search_exa", "websearch", "completed", { query: "exa" }, { metadata: { provider: "exa" } }),
    toolPart("prt_search_generic", "websearch", "completed", { query: "generic" }),
  ]
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })
  await page.getByRole("button", { name: "Used Parallel Web Search, Exa Web Search, Web Search" }).click()

  const tools = page.locator('[data-component="context-tool-group-list"]')
  await expect(tools.getByRole("button", { name: /Parallel Web Search/ })).toBeVisible()
  await expect(tools.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  await expect(tools.getByRole("button", { name: /^Web Search/ })).toBeVisible()
})

test("labels completed searches with result counts", async ({ page }) => {
  const glob = "prt_glob_count"
  const grep = "prt_grep_count"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(glob, "glob", "completed", { path: ".", pattern: "**/*.ts" }, { metadata: { count: 1 } }),
        toolPart(grep, "grep", "completed", { path: ".", pattern: "value" }, { metadata: { matches: 12 } }),
      ]),
    ],
  })

  const group = page.locator(`[data-timeline-part-ids="${glob},${grep}"]`)
  await group.locator('[data-slot="collapsible-trigger"]').click()
  const rows = group.locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
  await expect(rows.filter({ hasText: "Glob" })).toContainText("(1 match)")
  await expect(rows.filter({ hasText: "Grep" })).toContainText("(12 matches)")
})

test("labels read tools from their path input", async ({ page }) => {
  const id = "prt_read_path"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart(id, "read", "completed", { path: "src/a.ts" })])],
  })

  const group = page.locator(`[data-timeline-part-ids="${id}"]`)
  await group.locator('[data-slot="collapsible-trigger"]').click()
  await expect(
    group
      .locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
      .filter({ hasText: "Read" }),
  ).toContainText("a.ts")
})

test("labels skill tools from IDs and result metadata", async ({ page }) => {
  const pending = "prt_skill_id"
  const completed = "prt_skill_name"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(pending, "skill", "running", { id: "frontend-design" }),
        toolPart(completed, "skill", "completed", { id: "opencode" }, { metadata: { name: "OpenCode" } }),
      ]),
    ],
  })

  const group = page.locator(`[data-timeline-part-ids="${pending},${completed}"]`)
  await expect(group.getByRole("button")).toHaveAccessibleName("Used Skill")
  await expect(group.locator('[data-component="tag"]')).toHaveText("2")
  await group.getByRole("button").click()

  for (const [id, name] of [
    [pending, "frontend-design"],
    [completed, "OpenCode"],
  ] as const) {
    const skill = page.locator(`[data-timeline-part-id="${id}"]`)
    const loaded = skill.locator('[data-component="tool-loaded-item"]')
    await expect(loaded).toHaveAttribute("aria-label", `Loaded ${name} skill`)
    await expect(loaded).toHaveCSS("line-height", "16px")
    await expect(loaded.locator('[data-slot="tool-loaded-label"]')).toHaveText("Loaded")
    await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveText("skill")
    await expect(loaded.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", name)
  }
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

function errorInput(tool: string) {
  if (tool === "shell") return { command: "exit 1" }
  if (["edit", "write"].includes(tool)) return { path: "src/error.ts", content: "" }
  if (tool === "patch") return { patchText: "Update src/error.ts" }
  if (tool === "webfetch") return { url: "https://example.com" }
  if (tool === "websearch") return { query: "failure" }
  if (tool === "subagent") return { description: "Fail subagent", agent: "explore", prompt: "Inspect the failure." }
  if (tool === "skill") return { name: "failure" }
  return { target: "failure" }
}
