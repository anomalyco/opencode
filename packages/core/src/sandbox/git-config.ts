export * as SandboxGitConfig from "./git-config.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { AppProcess } from "@opencode/util/process"

// Only system and global origins are trusted: repository config can include arbitrary host files.
export const discover = Effect.fn("SandboxGitConfig.discover")(function* (
  directory: string,
  env: Record<string, string | undefined>,
) {
  const subprocess = yield* AppProcess.Service
  const result = yield* subprocess
    .run(
      ChildProcess.make("git", ["config", "--show-origin", "--show-scope", "--null", "--name-only", "--list"], {
        cwd: directory,
        env,
        extendEnv: false,
      }),
      { timeout: "5 seconds", maxOutputBytes: 1024 * 1024, maxErrorBytes: 4096 },
    )
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!result || result.exitCode !== 0 || result.stdoutTruncated) return []
  const fields = result.stdout.toString("utf8").split("\0")
  const origins: string[] = []
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [scope, origin] = fields.slice(index, index + 2)
    if ((scope === "system" || scope === "global") && origin?.startsWith("file:"))
      origins.push(path.resolve(directory, origin.slice(5)))
  }
  return yield* Effect.promise(async () => {
    const files = await Promise.all(
      origins.map(async (origin) => {
        const canonical = await fs.realpath(origin).catch(() => undefined)
        if (!canonical || !(await fs.stat(canonical).catch(() => undefined))?.isFile()) return undefined
        return canonical
      }),
    )
    return [...new Set(files.filter((file): file is string => file !== undefined))].sort()
  })
})
