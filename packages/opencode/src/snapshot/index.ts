import { App } from "../app/app"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import { z } from "zod"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export function init() {
    Array.fromAsync(
      new Bun.Glob("**/snapshot").scan({
        absolute: true,
        onlyFiles: false,
        cwd: Global.Path.data,
      }),
    ).then((files) => {
      for (const file of files) {
        fs.rmdir(file, { recursive: true })
      }
    })
  }

  export async function track() {
    const app = App.info()
    if (!app.git) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: app.path.root,
        })
        .quiet()
        .nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} add .`.quiet().cwd(app.path.cwd).nothrow()
    const hash = await $`git --git-dir ${git} write-tree`.quiet().cwd(app.path.cwd).nothrow().text()
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const app = App.info()
    const git = gitdir()
    await $`git --git-dir ${git} add .`.quiet().cwd(app.path.cwd).nothrow()
    const files = await $`git --git-dir ${git} diff --name-only ${hash} -- .`.cwd(app.path.cwd).text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(app.path.cwd, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const app = App.info()
    const git = gitdir()
    await $`git --git-dir=${git} read-tree ${snapshot} && git --git-dir=${git} checkout-index -a -f`
      .quiet()
      .cwd(app.path.root)
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git --git-dir=${git} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(App.info().path.root)
          .nothrow()
        if (result.exitCode !== 0) {
          log.info("file not found in history, deleting", { file })
          await fs.unlink(file).catch(() => {})
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const app = App.info()
    const git = gitdir()
    const result = await $`git --git-dir=${git} diff ${hash} -- .`.quiet().cwd(app.path.root).text()
    return result.trim()
  }

  function gitdir() {
    const app = App.info()
    return path.join(app.path.data, "snapshots")
  }
}
