// `/worktrees` on home (P16, P17, DLG26, DLG27): the worktrees dialog lists the project's checkouts, the first
// delete press marks a worktree and a move clears the mark, `ctrl+a` names a new worktree, and Enter stages it
// for the first submit, which the footer shows as "(new worktree)".
import { defineApp } from "../../lib/app"

// The home placeholder picks a random example.
const placeholder = [{ x: 16, y: 16, width: 74, height: 1, reason: "random placeholder example" }]

export default defineApp({
  routes: [
    {
      path: "/api/worktree",
      json: [{ directory: "/tmp/opencode" }, { directory: "/tmp/opencode-spike", strategy: "git" }],
    },
    { method: "POST", path: "/api/worktree/refresh", status: 204 },
  ],
  steps: [
    // Typing waits for the home prompt.
    { checkpoint: "home", until: "Ask anything", masks: placeholder },
    { type: "/worktrees" },
    // Enter waits for the popup.
    { checkpoint: "slash", until: "Manage workspaces" },
    { keys: ["enter"] },
    { checkpoint: "list", until: "opencode-spike" },
    { keys: ["down", "ctrl+d"] },
    { checkpoint: "marked", until: "again to confirm" },
    { keys: ["down", "ctrl+a"] },
    { checkpoint: "name", until: "Name worktree" },
    { type: "My Spike" },
    { keys: ["enter"] },
    { checkpoint: "staged", until: "(new worktree)", masks: placeholder },
  ],
})
