export * as ConfigPaths from "./paths"

import path from "path"
import { Filesystem } from "@/util"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { unique } from "remeda"
import { JsonError } from "./error"

export async function projectFiles(name: string, directory: string, worktree?: string) {
  return Filesystem.findUp([`${name}.json`, `${name}.jsonc`], directory, worktree, { rootFirst: true })
}

export async function directories(directory: string, worktree?: string) {
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? await Array.fromAsync(
          Filesystem.up({
            targets: [".opencode"],
            start: directory,
            stop: worktree,
          }),
        )
      : []),
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".opencode"],
        start: Global.Path.home,
        stop: Global.Path.home,
      }),
    )),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
}

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

/** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
export async function readFile(filepath: string) {
  return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return
    throw new JsonError({ path: filepath }, { cause: err })
  })
}
