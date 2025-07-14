import { App } from "../app/app"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Ripgrep } from "../file/ripgrep"
import { Log } from "../util/log"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export async function create(sessionID: string) {
    log.info("creating snapshot")
    const app = App.info()

    // not a git repo, check if too big to snapshot
    if (!app.git) {
      const files = await Ripgrep.files({
        cwd: app.path.cwd,
        limit: 1000,
      })
      log.info("found files", { count: files.length })
      if (files.length > 1000) return
    }

    const git = gitdir(sessionID)
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

    const result = await $`git --git-dir ${git} commit -m "snapshot" --author="opencode <mail@opencode.ai>"`
      .quiet()
      .cwd(app.path.cwd)
      .nothrow()

    const match = result.stdout.toString().match(/\[.+ ([a-f0-9]+)\]/)
    if (!match) return
    return match![1]
  }

  export async function restore(sessionID: string, snapshot: string) {
    log.info("restore", { commit: snapshot })
    const app = App.info()
    const git = gitdir(sessionID)
    await $`git --git-dir=${git} checkout ${snapshot} --force`.quiet().cwd(app.path.root)
  }

  export async function diff(sessionID: string, commit: string) {
    const git = gitdir(sessionID)
    const result = await $`git --git-dir=${git} diff -R ${commit}`.quiet().cwd(App.info().path.root)
    return result.stdout.toString("utf8")
  }

  function gitdir(sessionID: string) {
    const app = App.info()
    return path.join(app.path.data, "snapshot", sessionID)
  }
}
