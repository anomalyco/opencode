import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod/v4"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

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
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        })
        .quiet()
        .nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} add .`.quiet().cwd(Instance.directory).nothrow()
    const hash = await $`git --git-dir ${git} write-tree`.quiet().cwd(Instance.directory).nothrow().text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await $`git --git-dir ${git} add .`.quiet().cwd(Instance.directory).nothrow()
    const result = await $`git --git-dir ${git} diff --name-only ${hash} -- .`.quiet().cwd(Instance.directory).nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result = await $`git --git-dir=${git} read-tree ${snapshot} && git --git-dir=${git} checkout-index -a -f`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
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
          .cwd(Instance.worktree)
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
    const git = gitdir()
    const result = await $`git --git-dir=${git} diff ${hash} -- .`.quiet().cwd(Instance.worktree).nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
