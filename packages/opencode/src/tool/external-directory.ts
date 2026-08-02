import path from "path"
import { realpathSync } from "fs"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@opencode-ai/core/fs-util"

type Kind = "file" | "directory"

// `containsPath` is pure path math (`path.relative`), but every caller then hands the
// same string to an fs call, and fs follows symlinks. A link inside the project that
// points outside it therefore passed the check while the read/write landed outside --
// and the permission prompt rendered the in-project path, so it named the wrong file.
//
// Windows already resolved here via `normalizePath` (which calls `realpathSync.native`).
// Do the same on POSIX so both platforms check, and display, the path the filesystem
// will actually touch.
function resolveTarget(target: string) {
  return follow(process.platform === "win32" ? FSUtil.normalizePath(target) : path.resolve(target))
}

// A plain realpath is not enough: `write` and `apply_patch` legitimately target files
// that do not exist yet, and realpath fails with ENOENT on those. Walk up to the nearest
// existing ancestor and re-attach the tail, so a symlinked parent directory is still
// followed. Any other error (ELOOP, EACCES) keeps the lexical path, which is the
// behaviour that shipped before -- resolution is a guard here, not a hard requirement.
function follow(input: string): string {
  try {
    return realpathSync(input)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") return input
    const parent = path.dirname(input)
    if (parent === input) return input
    return path.join(follow(parent), path.basename(input))
  }
}

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false

  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  const full = resolveTarget(target)
  if (containsPath(full, ins)) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
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
  return true
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}
