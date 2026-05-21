import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/PermissionProject"
const project = {
  id: "proj_permission_prompt",
  worktree: directory,
  vcs: "git",
  name: "permission-project",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}
const provider = {
  all: [
    {
      id: "opencode",
      name: "OpenCode",
      models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6" } },
    },
  ],
  connected: ["opencode"],
  default: { providerID: "opencode", modelID: "claude-opus-4-6" },
}
const rootSession = {
  id: "ses_permission_root",
  projectID: project.id,
  directory,
  title: "Root session with subagent prompt",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}
const childSession = {
  id: "ses_permission_child",
  parentID: rootSession.id,
  projectID: project.id,
  directory,
  title: "Subagent permission prompt",
  version: "dev",
  time: { created: 1700000001000, updated: 1700000001000 },
}
const childPermission = {
  id: "per_child_bash_date",
  sessionID: childSession.id,
  permission: "bash",
  patterns: ["date"],
  always: ["date"],
  metadata: { command: "date" },
}

test.describe("smoke: session permission prompt", () => {
  test("replies to nested subagent permissions with the request-scoped endpoint", async ({ page }) => {
    const replies: Array<{ requestID: string; body: unknown }> = []
    const deprecated: Array<{ sessionID: string; permissionID: string; body: unknown }> = []

    await mockOpenCodeServer(page, {
      provider,
      directory,
      project,
      sessions: [rootSession, childSession],
      permissions: [childPermission],
      onPermissionReply: (input) => replies.push(input),
      onDeprecatedPermissionRespond: (input) => deprecated.push(input),
      pageMessages: () => ({ items: [] }),
    })

    await page.addInitScript((directory) => {
      localStorage.setItem("opencode.settings.dat:defaultServerUrl", "http://localhost:4097")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
    }, directory)

    await page.goto(`/${base64Encode(directory)}/session/${rootSession.id}`)
    await expect(page.getByRole("heading", { name: rootSession.title })).toBeVisible()
    await expect(page.getByText("date")).toBeVisible()

    await page.getByRole("button", { name: "Allow once" }).click()

    await expect
      .poll(() => replies)
      .toEqual([
        {
          requestID: childPermission.id,
          body: { reply: "once" },
        },
      ])
    expect(deprecated).toEqual([])
    await expect(page.getByRole("button", { name: "Allow once" })).toHaveCount(0)
  })
})
