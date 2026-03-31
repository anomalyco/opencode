import z from "zod"
import { Tool } from "./tool"
import { Worktree } from "../worktree"
import ENTER_DESCRIPTION from "./worktree-enter.txt"
import EXIT_DESCRIPTION from "./worktree-exit.txt"

export const EnterWorktreeTool = Tool.define("worktree_enter", {
  description: ENTER_DESCRIPTION,
  parameters: Worktree.CreateInput,
  async execute(input, ctx) {
    const pattern = input.name?.trim() || "*"
    await ctx.ask({
      permission: "worktree_enter",
      patterns: [pattern],
      always: ["*"],
      metadata: {
        name: input.name,
        startCommand: input.startCommand,
      },
    })

    const info = await Worktree.create(input)
    return {
      title: `Entered worktree ${info.name}`,
      output: [`name: ${info.name}`, `branch: ${info.branch}`, `directory: ${info.directory}`].join("\n"),
      metadata: info,
    }
  },
})

const exit = z.object({
  directory: Worktree.RemoveInput.shape.directory.describe("Sandbox worktree directory to remove"),
})

export const ExitWorktreeTool = Tool.define("worktree_exit", {
  description: EXIT_DESCRIPTION,
  parameters: exit,
  async execute(input, ctx) {
    await ctx.ask({
      permission: "worktree_exit",
      patterns: [input.directory],
      always: ["*"],
      metadata: {
        directory: input.directory,
      },
    })

    const removed = await Worktree.remove(input)
    return {
      title: removed ? "Removed worktree" : "Worktree removal skipped",
      output: removed ? `Removed worktree: ${input.directory}` : `Worktree not removed: ${input.directory}`,
      metadata: {
        directory: input.directory,
        removed,
      },
    }
  },
})
