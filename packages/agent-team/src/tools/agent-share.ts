import { tool } from "@opencode-ai/plugin/tool"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentShareTool(orch: Orchestrator) {
  return tool({
    description: "Share your changes from your worktree to the team workspace. Creates a branch and attempts to merge.",
    args: {
      branch: tool.schema.string().describe("Your worktree branch name to share"),
      description: tool.schema.string().describe("Description of changes being shared"),
      auto_merge: tool.schema.boolean().optional().describe("Auto-merge if no conflicts"),
      validation_command: tool.schema.string().optional().describe("Command to validate before merge"),
    },
    async execute(args, ctx) {
      const info = orch.getInfo(ctx.agent)
      if (!info) return "Error: agent not found"
      const proc = Bun.spawn(["git", "rev-parse", "--verify", args.branch], {
        cwd: ctx.worktree,
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      if (proc.exitCode !== 0) return "Error: branch does not exist"
      if (args.validation_command) {
        const vproc = Bun.spawn(["sh", "-c", args.validation_command], {
          cwd: ctx.directory,
          stdout: "pipe",
          stderr: "pipe",
        })
        await vproc.exited
        if (vproc.exitCode !== 0) {
          const out = await new Response(vproc.stdout).text()
          return `validation_failed: ${out}`
        }
      }
      await orch.audit.append({
        agent: ctx.agent,
        action: "share.request",
        target: args.branch,
        details: { description: args.description, auto_merge: args.auto_merge },
      })
      return `Share request for branch "${args.branch}" submitted: ${args.description}`
    },
  })
}
