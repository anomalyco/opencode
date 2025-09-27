import { $ } from "bun"
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
  if (options?.git) await $`git init`.cwd(dirpath).quiet()
  const extra = await options?.init?.(dirpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      await $`rm -rf ${dirpath}`.quiet()
    },
    path: dirpath,
    extra: extra as T,
  }
  return result
}
