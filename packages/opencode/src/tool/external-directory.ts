import path from "path"
import type { Tool } from "./tool"
import { ConfigPaths } from "../config/paths"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

function internal(target: string) {
  const file = path.isAbsolute(target) ? target : path.join(Instance.directory, target)
  if (Instance.containsPath(file)) return true
  return ConfigPaths.globalDirectories().some((dir) => Filesystem.contains(path.resolve(dir), file))
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  if (internal(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
