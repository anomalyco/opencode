import z from "zod"
import { Tool } from "./tool"
import { Worktree } from "../worktree"
import { Session } from "../session"
import { Instance } from "../project/instance"

export const WorktreeEnterTool = Tool.define("worktree_enter", {
  description:
    "Create and enter a git worktree. Provisions a fresh worktree directory under the opencode data path and updates the session working directory. Use worktree_exit to return to the main workspace.",
  parameters: z.object({
    name: z.string().optional().describe("Optional name for the worktree branch (auto-generated if omitted)"),
    startCommand: z.string().optional().describe("Optional shell command to run after creating the worktree"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["git worktree add"],
      always: ["*"],
      metadata: {},
    })

    const info = await Worktree.create({ name: params.name, startCommand: params.startCommand })
    await Session.setDirectory({ sessionID: ctx.sessionID, directory: info.directory }).catch(() => {})
    await Instance.reload({ directory: info.directory })

    return {
      title: `worktree enter ${info.name}`,
      metadata: { directory: info.directory, branch: info.branch, name: info.name },
      output: `Created and entered worktree "${info.name}" at ${info.directory} (branch: ${info.branch}). Working directory updated.`,
    }
  },
})

export const WorktreeExitTool = Tool.define("worktree_exit", {
  description:
    "Exit the current git worktree and return to the main workspace directory. Optionally removes the worktree.",
  parameters: z.object({
    remove: z.boolean().optional().describe("Remove the worktree after exiting (default: false)"),
  }),
  async execute(params, ctx) {
    const current = Instance.directory
    const root = Instance.worktree

    if (current === root) {
      throw new Error("Not inside a worktree — already at the main workspace directory.")
    }

    await ctx.ask({
      permission: "bash",
      patterns: ["git worktree remove"],
      always: ["*"],
      metadata: { current, root },
    })

    await Session.setDirectory({ sessionID: ctx.sessionID, directory: root }).catch(() => {})
    await Instance.reload({ directory: root })

    if (params.remove) {
      await Worktree.remove({ directory: current })
    }

    return {
      title: `worktree exit`,
      metadata: { previous: current, directory: root, removed: params.remove ?? false },
      output: `Returned to main workspace at ${root}${params.remove ? `. Worktree at ${current} has been removed.` : "."}.`,
    }
  },
})
