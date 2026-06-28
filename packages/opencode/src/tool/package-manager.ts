import path from "path"
import { Effect } from "effect"
import type { FSUtil } from "@opencode-ai/core/fs-util"

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

/** Detect the JS package manager for a directory by its lockfile. Defaults to npm. */
export const detect = Effect.fn("PackageManager.detect")(function* (fs: FSUtil.Interface, cwd: string) {
  if (yield* fs.existsSafe(path.join(cwd, "bun.lock"))) return "bun" as PackageManager
  if (yield* fs.existsSafe(path.join(cwd, "bun.lockb"))) return "bun" as PackageManager
  if (yield* fs.existsSafe(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm" as PackageManager
  if (yield* fs.existsSafe(path.join(cwd, "yarn.lock"))) return "yarn" as PackageManager
  return "npm" as PackageManager
})

export function addArgs(pm: PackageManager, packages: string[], dev: boolean): string[] {
  switch (pm) {
    case "bun":
      return ["add", ...(dev ? ["-d"] : []), ...packages]
    case "pnpm":
      return ["add", ...(dev ? ["-D"] : []), ...packages]
    case "yarn":
      return ["add", ...(dev ? ["-D"] : []), ...packages]
    case "npm":
      return ["install", dev ? "--save-dev" : "--save", ...packages]
  }
}

export function outdatedArgs(pm: PackageManager): string[] {
  return ["outdated"]
}
