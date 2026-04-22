import path from "path"
import { FileTime } from "@/file/time"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "@/tool/external-directory"
import type { Tool } from "@/tool/shared/tool"

export async function file(file: string, ctx: Tool.Context, permission = "inspect") {
  const out = path.isAbsolute(file) ? file : path.resolve(Instance.directory, file)
  const stat = await Filesystem.statAsync(out)
  if (!stat?.isFile()) throw new Error(`File not found: ${out}`)
  await assertExternalDirectory(ctx, out, { kind: "file" })
  await ctx.ask({
    permission,
    patterns: [out],
    always: ["*"],
    metadata: { filePath: out },
  })
  await FileTime.read(ctx.sessionID, out)
  return out
}

export async function dir(dir: string | undefined, ctx: Tool.Context, permission = "inspect") {
  const out = path.resolve(Instance.directory, dir ?? ".")
  const stat = await Filesystem.statAsync(out)
  if (!stat?.isDirectory()) throw new Error(`Directory not found: ${out}`)
  await assertExternalDirectory(ctx, out, { kind: "directory" })
  await ctx.ask({
    permission,
    patterns: [out],
    always: ["*"],
    metadata: { path: out },
  })
  return out
}

export function title(file: string) {
  return path.relative(Instance.worktree, file)
}

export function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}
