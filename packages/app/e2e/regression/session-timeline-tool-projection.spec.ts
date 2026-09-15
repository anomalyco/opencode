import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("renders every tool error outcome without leaking hidden tools", async ({ page }) => {
  const ordinary = ["bash", "edit", "write", "apply_patch", "webfetch", "websearch", "task", "skill", "mcp_probe"]
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
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(shellID, "bash", "pending", { command: "exit 1" }),
          toolPart(questionID, "question", "pending", questionInput()),
        ],
        { completed: false },
      ),
    ],
  })
  await timeline.waitForPart(shellID)
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(toolPart(shellID, "bash", "running", { command: "exit 1" })), 120)
  await timeline.send(partUpdated(toolPart(questionID, "question", "running", questionInput())), 180)
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(
    partUpdated(toolPart(shellID, "bash", "error", { command: "exit 1" }, { error: "Command exited 1" })),
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

  await expect(page.getByRole("button", { name: /Parallel Web Search/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Web Search/ })).toBeVisible()
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

function errorInput(tool: string) {
  if (tool === "bash") return { command: "exit 1" }
  if (["edit", "write"].includes(tool)) return { filePath: "src/error.ts", content: "" }
  if (tool === "apply_patch") return { files: ["src/error.ts"] }
  if (tool === "webfetch") return { url: "https://example.com" }
  if (tool === "websearch") return { query: "failure" }
  if (tool === "task") return { description: "Fail task", subagent_type: "explore" }
  if (tool === "skill") return { name: "failure" }
  return { target: "failure" }
}
