import z from "zod"
import path from "path"
import os from "os"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Session } from "../session"

const DESCRIPTION = `Change the working directory for the current session.

Use this tool when you need to:
- Switch to a different git worktree
- Navigate to a cloned repository
- Change context to a different project directory

The directory change is permanent for this session - all subsequent file operations will use the new directory as the base.

Usage notes:
- Paths can be absolute or relative to the current directory
- Use ~ for the home directory
- The new directory must exist
- This will update the session's directory context`

export const CdTool = Tool.define("cd", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("Target directory path (absolute or relative to current directory)"),
  }),
  async execute(params, ctx) {
    // Ask for permission before changing directory
    await ctx.ask({
      permission: "cd",
      patterns: [params.path],
      always: ["*"],
      metadata: {
        path: params.path,
        currentDirectory: Instance.directory,
      },
    })

    // Expand ~ to home directory
    const targetPath = params.path.startsWith("~") ? path.join(os.homedir(), params.path.slice(1)) : params.path

    // Change directory using Instance.setDirectory
    const result = await Instance.setDirectory(targetPath)

    // Update the session's directory field (may fail if session doesn't exist in tests)
    await Session.update(ctx.sessionID, (draft) => {
      draft.directory = result.directory
    }).catch(() => {})

    return {
      title: `cd ${params.path}`,
      metadata: {
        directory: result.directory,
        worktree: result.worktree,
        projectID: result.project.id,
      },
      output: `Changed working directory to: ${result.directory}\nWorktree: ${result.worktree}\nProject ID: ${result.project.id}`,
    }
  },
})
