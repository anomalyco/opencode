// Deleting a worktree with file changes (DLG25, DLG26): the server refuses the plain delete with
// `forceRequired`, so the TUI lists the changes and asks again; `d` deletes with `force`. The fake server
// refuses that too, which shows the failure toast and the list again.
import { defineApp } from "../../lib/app"

// The TS placeholder picks a random example; the Rust home prompt draws none yet (T17-home-prompt).
const placeholder = [{ x: 16, y: 16, width: 74, height: 1, reason: "random placeholder example" }]

const refused = {
  _tag: "WorktreeError",
  name: "WorktreeError",
  data: { message: "worktree contains modified or untracked files", forceRequired: true },
}

export default defineApp({
  routes: [
    {
      path: "/api/worktree",
      json: [{ directory: "/tmp/opencode" }, { directory: "/tmp/opencode-spike", strategy: "git" }],
    },
    { method: "POST", path: "/api/worktree/refresh", status: 204 },
    { method: "DELETE", path: "/api/worktree", status: 400, json: refused },
    {
      path: "/api/vcs/status",
      json: {
        location: { directory: "/tmp/opencode-spike" },
        data: [
          { file: "src/parser.ts", additions: 12, deletions: 3, status: "modified" },
          { file: "notes.md", additions: 4, deletions: 0, status: "added" },
          { file: "old.txt", additions: 0, deletions: 9, status: "deleted" },
        ],
      },
    },
  ],
  steps: [
    // Typing waits for the home prompt.
    { checkpoint: "home", until: "Ask anything", masks: placeholder },
    { type: "/worktrees" },
    // Enter waits for the popup.
    { checkpoint: "slash", until: "Manage workspaces" },
    { keys: ["enter"] },
    { checkpoint: "list", until: "opencode-spike" },
    { keys: ["down", "ctrl+d", "ctrl+d"] },
    // The home prompt behind the dialog draws no placeholder yet.
    { checkpoint: "changes", until: "old.txt", deviation: ["T17-home-prompt"] },
    { keys: ["d"] },
    { checkpoint: "failed", until: "Failed to delete worktree" },
  ],
})
