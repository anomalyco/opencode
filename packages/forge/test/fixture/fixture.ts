import { $ } from "bun"
import { realpathSync } from "fs"
import os from "os"
import path from "path"

type TmpDirOptions<T> = {
  git?: boolean
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
  await $`mkdir -p ${dirpath}`.quiet()
  let repoID: string | null = null
  if (options?.git) {
    await $`git init`.cwd(dirpath).quiet()
    await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet()
    const { Git } = await import("../../src/git")
    repoID = await Git.getRepoID(realpathSync(dirpath))
  }
  const extra = await options?.init?.(dirpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // Clean up any workspaces created for this repo (handles failed tests)
      if (repoID) {
        const { Workspace } = await import("../../src/workspace")
        const workspaces = await Workspace.list(repoID)
        for (const ws of workspaces) {
          await Workspace.remove(ws.id)
        }
      }
      await $`rm -rf ${dirpath}`.quiet()
    },
    path: realpathSync(dirpath),
    extra: extra as T,
  }
  return result
}
