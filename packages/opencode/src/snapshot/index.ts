import { App } from "../app/app"
import {
  add,
  commit,
  init,
  checkout,
  statusMatrix,
  remove,
} from "isomorphic-git"
import path from "path"
import fs from "fs"
import { Ripgrep } from "../file/ripgrep"
import { Log } from "../util/log"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export async function create(sessionID: string) {
    const app = App.info()
    const git = gitdir(sessionID)
    const files = await Ripgrep.files({
      cwd: app.path.cwd,
      limit: app.git ? undefined : 1000,
    })
    // not a git repo and too big to snapshot
    if (!app.git && files.length === 1000) return
    await init({
      dir: app.path.cwd,
      gitdir: git,
      fs,
    })
    const status = await statusMatrix({
      fs,
      gitdir: git,
      dir: app.path.cwd,
    })
    await add({
      fs,
      gitdir: git,
      parallel: true,
      dir: app.path.cwd,
      filepath: files,
    })
    for (const [file, _head, workdir, stage] of status) {
      if (workdir === 0 && stage === 1) {
        log.info("remove", { file })
        await remove({
          fs,
          gitdir: git,
          dir: app.path.cwd,
          filepath: file,
        })
      }
    }
    const result = await commit({
      fs,
      gitdir: git,
      dir: app.path.cwd,
      message: "snapshot",
      author: {
        name: "opencode",
        email: "mail@opencode.ai",
      },
    })
    log.info("commit", { result })
    return result
  }

  export async function restore(sessionID: string, commit: string) {
    log.info("restore", { commit })
    const app = App.info()
    await checkout({
      fs,
      gitdir: gitdir(sessionID),
      dir: app.path.cwd,
      ref: commit,
      force: true,
    })
  }

  function gitdir(sessionID: string) {
    const app = App.info()
    return path.join(app.path.data, "snapshot", sessionID)
  }
}
