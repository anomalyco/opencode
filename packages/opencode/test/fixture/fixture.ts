import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"
import { Filesystem } from "../../src/util/filesystem"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    const init = await $`git init`.cwd(dirpath).nothrow().quiet()
    if (init.exitCode !== 0) {
      console.error("git init failed", {
        dirpath,
        exitCode: init.exitCode,
        stdout: init.stdout.toString(),
        stderr: init.stderr.toString(),
      })
    }
    const commit = await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).nothrow().quiet()
    if (commit.exitCode !== 0) {
      console.error("git commit failed", {
        dirpath,
        exitCode: commit.exitCode,
        stdout: commit.stdout.toString(),
        stderr: commit.stderr.toString(),
      })
    }
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  const realpath = Filesystem.normalize(sanitizePath(await fs.realpath(dirpath)))
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // await fs.rm(dirpath, { recursive: true, force: true })
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}
