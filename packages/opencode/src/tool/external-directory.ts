import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "@/util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  target = Filesystem.normalize(target)
  if (Instance.containsPath(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : Filesystem.dirname(target)
  const glob = Filesystem.join(parentDir, "*")

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
