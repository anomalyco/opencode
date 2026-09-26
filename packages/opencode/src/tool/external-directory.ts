import path from "path"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@opencode-ai/core/fs-util"

type Kind = "file" | "directory"

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
  const full = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  // Lexical containment is not enough: a symlink inside the worktree can point
  // outside it (e.g. `vendor/x -> /etc`). Require both the lexical path and its
  // symlink-resolved target to stay inside before skipping the prompt.
  const resolved = FSUtil.resolveExisting(full)
  if (containsPath(full, ins) && containsPath(resolved, ins)) return false

  // The persisted `always` grant is keyed on the *resolved* target: keying it
  // lexically would let a later symlink swap (`vendor -> /etc`) reuse a
  // `vendor/*` grant on `/etc/*` without re-prompting. The request `patterns`
  // stay on the user-visible lexical path so a pre-approved config rule written
  // against an alias/symlink path (macOS `/tmp` -> `/private/tmp`, vendored
  // worktree aliases) still matches. `Permission.ask` requires *every* pattern to
  // be allowed, so adding the resolved form here would force a prompt even when
  // the lexical rule is allowed; the resolved target is surfaced through
  // `metadata` instead. Trade-off: an interactively-approved symlink alias
  // re-prompts on each call (its cached grant is the resolved path), which is the
  // conservative direction.
  const kind = options?.kind ?? "file"
  const targetDir = (p: string) => (kind === "directory" ? p : path.dirname(p))
  const toGlob = (p: string) =>
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(p, "*"))
      : path.join(p, "*").replaceAll("\\", "/")
  const dir = targetDir(resolved)
  const resolvedGlob = toGlob(dir)
  const lexicalGlob = toGlob(targetDir(full))

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [lexicalGlob],
    always: [resolvedGlob],
    metadata: {
      filepath: resolved,
      parentDir: dir,
    },
  })
  return true
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}
