import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Session } from "../session"
import { Instance } from "../project/instance"
import DESCRIPTION from "./add-dir.txt"

export const AddDirTool = Tool.define("add_directory", {
  description: DESCRIPTION,
  parameters: z.object({
    directory: z.string().describe("The absolute path to the directory to add"),
  }),
  async execute(params, ctx) {
    const dirPath = path.isAbsolute(params.directory)
      ? params.directory
      : path.join(Instance.directory, params.directory)

    // Verify directory exists
    try {
      const stats = await fs.stat(dirPath)
      if (!stats.isDirectory()) {
        throw new Error(`Path ${dirPath} exists but is not a directory`)
      }
    } catch (error) {
      throw new Error(`Directory ${dirPath} does not exist or is not accessible`)
    }

    // Add to session
    await Session.AllowedDirectories.add({
      sessionID: ctx.sessionID,
      directory: dirPath,
    })

    const output = `Successfully added directory to session: ${dirPath}\n\nAgents can now access files in this directory using read, write, edit, patch, and bash tools.\n\nNote: This directory is only accessible for this session. To make it available for all sessions, add it to your project's opencode.jsonc config file under "allowedDirectories".`

    return {
      title: "Directory Added",
      output,
      metadata: {
        directory: dirPath,
      },
    }
  },
})
