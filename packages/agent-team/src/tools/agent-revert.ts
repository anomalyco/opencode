import { tool } from "@opencode-ai/plugin/tool"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentRevertTool(orch: Orchestrator) {
  return tool({
    description: "Revert a previously merged share to the team workspace. Use with caution.",
    args: {
      merge_commit: tool.schema.string().describe("The merge commit hash to revert"),
      reason: tool.schema.string().describe("Why you are reverting"),
    },
    async execute(args, ctx) {
      const proc = Bun.spawn(["git", "rev-parse", "--verify", args.merge_commit], {
        cwd: ctx.worktree,
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      if (proc.exitCode !== 0) return "Error: merge commit does not exist"
      const revert = Bun.spawn(["git", "revert", "--no-edit", args.merge_commit], {
        cwd: ctx.worktree,
        stdout: "pipe",
        stderr: "pipe",
      })
      await revert.exited
      if (revert.exitCode !== 0) {
        const err = await new Response(revert.stderr).text()
        return `Error: revert failed: ${err}`
      }
      await orch.audit.append({
        agent: ctx.agent,
        action: "share.revert",
        target: args.merge_commit,
        details: { reason: args.reason },
      })
      return `Reverted commit ${args.merge_commit}`
    },
  })
}
