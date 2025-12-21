import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Permission } from "../permission"
import { Agent } from "../agent/agent"
import { ExternalPermission } from "../util/external-permission"

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
  }),
  async execute(params, ctx) {
    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
    const agent = await Agent.get(ctx.agent)

    if (!Filesystem.contains(Instance.directory, search)) {
      const externalPerm = ExternalPermission.resolve(agent.permission.external_directory, search, "read")
      if (externalPerm === "ask") {
        await Permission.ask({
          type: "external_directory",
          pattern: [search, path.join(search, "*")],
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: `Search directory outside working directory: ${search}`,
          metadata: { searchPath: search },
        })
      } else if (externalPerm === "deny") {
        throw new Permission.RejectedError(
          ctx.sessionID,
          "external_directory",
          ctx.callID,
          { searchPath: search },
          `Directory ${search} is not in the current working directory`,
        )
      }
    }

    const limit = 100
    const files = []
    let truncated = false
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
    })) {
      if (files.length >= limit) {
        truncated = true
        break
      }
      const full = path.resolve(search, file)
      const stats = await Bun.file(full)
        .stat()
        .then((x) => x.mtime.getTime())
        .catch(() => 0)
      files.push({
        path: full,
        mtime: stats,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push("(Results are truncated. Consider using a more specific path or pattern.)")
      }
    }

    return {
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
