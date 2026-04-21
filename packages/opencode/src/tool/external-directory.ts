import path from "path"
import { Effect } from "effect"
import { EffectLogger } from "@/effect"
import { InstanceState } from "@/effect"
import type * as Tool from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export function resolveWindowsPathFromDirectory(target: string, directory: string) {
  const next = AppFileSystem.windowsPath(target)
  const root = path.win32.parse(next).root
  if (root !== "/" && root !== "\\") return next
  return path.resolve(directory, next)
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return

  if (options?.bypass) return

  const ins = yield* InstanceState.context
  const full =
    process.platform === "win32"
      ? AppFileSystem.normalizePath(resolveWindowsPathFromDirectory(target, ins.directory))
      : target
  if (Instance.containsPath(full, ins)) return

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options).pipe(Effect.provide(EffectLogger.layer)))
}
