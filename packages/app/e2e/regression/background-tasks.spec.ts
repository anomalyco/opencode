import { expect, test } from "@playwright/test"
import { base64Encode } from "@cedric/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/BackgroundTaskRegression"
const projectID = "proj_background_task_regression"
const parentID = "ses_background_task_parent"
const childID = "ses_background_task_child"
const model = { providerID: "opencode", modelID: "chat-model" }

test("shows background task rows in the session surface", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "background-task-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "chat-model": {
              id: "chat-model",
              name: "Chat Model",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: model,
    },
    sessions: [session(parentID, "Background task parent"), session(childID, "Research auth (@researcher subagent)", parentID)],
    pageMessages: (sessionID) => ({ items: sessionID === parentID ? parentMessages() : [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${parentID}`)
  const backgroundTasks = page.locator('[data-component="background-tasks"]')
  await expectAppVisible(backgroundTasks.getByText("Background Tasks"))
  await expect(backgroundTasks.getByText("Research auth")).toBeVisible()
  await expect(backgroundTasks.getByText("researcher")).toBeVisible()
  await expect(backgroundTasks.getByText("Done")).toBeVisible()

  await backgroundTasks.getByRole("button", { name: "View background task" }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
})

function session(id: string, title: string, parentID?: string) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    parentID,
    agent: parentID ? "researcher" : "build",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function parentMessages() {
  const userID = "msg_background_task_user"
  const assistantID = "msg_background_task_assistant"
  const resultID = "msg_background_task_result"
  return [
    {
      info: {
        id: userID,
        sessionID: parentID,
        role: "user",
        time: { created: 1700000000000 },
        summary: { diffs: [] },
        agent: "build",
        model,
      },
      parts: [{ id: "prt_background_task_user", sessionID: parentID, messageID: userID, type: "text", text: "Research auth" }],
    },
    {
      info: {
        id: assistantID,
        sessionID: parentID,
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000002000 },
        parentID: userID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          id: "prt_background_task_tool",
          sessionID: parentID,
          messageID: assistantID,
          type: "tool",
          callID: "call_background_task",
          tool: "task",
          state: {
            status: "completed",
            input: { description: "Research auth", subagent_type: "researcher", background: true },
            output: '<task id="ses_background_task_child" state="running"><task_result>Started</task_result></task>',
            title: "Research auth",
            metadata: {
              background: true,
              parentSessionId: parentID,
              sessionId: childID,
              jobId: childID,
            },
            time: { start: 1700000001000, end: 1700000002000 },
          },
        },
      ],
    },
    {
      info: {
        id: resultID,
        sessionID: parentID,
        role: "user",
        time: { created: 1700000003000 },
        summary: { diffs: [] },
        agent: "build",
        model,
      },
      parts: [
        {
          id: "prt_background_task_result",
          sessionID: parentID,
          messageID: resultID,
          type: "text",
          synthetic: true,
          text: [
            '<task id="ses_background_task_child" state="completed">',
            "<summary>Background task completed: Research auth</summary>",
            "<task_result>",
            "Use a session-backed OAuth flow.",
            "</task_result>",
            "</task>",
          ].join("\n"),
        },
      ],
    },
  ]
}
