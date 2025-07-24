import { App } from "../app/app"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Ripgrep } from "../file/ripgrep"
import { Log } from "../util/log"
import { Global } from "../global"
import { Installation } from "../installation"

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

  export async function create() {
    log.info("creating snapshot")
    const app = App.info()

    // not a git repo, check if too big to snapshot
    if (!app.git || !Installation.isDev()) {
      return
      const files = await Ripgrep.files({
        cwd: app.path.cwd,
        limit: 1000,
      })
      log.info("found files", { count: files.length })
      if (files.length >= 1000) return
    }

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
    log.info("added files")

    const result =
      await $`git --git-dir ${git} commit --allow-empty -m "snapshot" --no-gpg-sign --author="opencode <mail@opencode.ai>"`
        .quiet()
        .cwd(app.path.cwd)
        .nothrow()

    const match = result.stdout.toString().match(/\[.+ ([a-f0-9]+)\]/)
    if (!match) return
    return match![1]
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const app = App.info()
    const git = gitdir()
    await $`git --git-dir=${git} reset --hard ${snapshot}`.quiet().cwd(app.path.root)
  }

  export async function diff(commit: string) {
    const git = gitdir()
    const result = await $`git --git-dir=${git} diff -R ${commit}`.quiet().cwd(App.info().path.root)
    const text = result.stdout.toString("utf8")
    return text
  }

  function gitdir() {
    const app = App.info()
    return path.join(app.path.data, "snapshots")
  }
}
