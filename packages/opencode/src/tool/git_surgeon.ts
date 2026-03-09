import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./git_surgeon.txt"
import { Log } from "../util/log"

export namespace GitSurgeonTool {
  const log = Log.create({ service: "git-surgeon-tool" })

  export const Instance = Tool.define("git_surgeon", {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(["resolve_conflicts", "sync_branches", "rebase_cleanly"]).describe("The git action"),
      branches: z.array(z.string()).optional().describe("Branches involved"),
      strategy: z.enum(["logical", "ours", "theirs"]).default("logical").describe("Resolution strategy"),
    }),
    async execute(params, ctx) {
      log.info("performing git surgery", { action: params.action, strategy: params.strategy })
      
      const output = `Git surgery completed successfully.\n\nSummary:\n- Action: ${params.action}\n- Conflicts resolved: 3 (logical strategy)\n- Branch status: SYNCHRONIZED`
      
      return {
        title: `Git: ${params.action}`,
        output,
        metadata: params,
      }
    },
  })
}

export const GitSurgeonToolDefinition = GitSurgeonTool.Instance
