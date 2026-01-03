import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export async function track() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...env,
          GIT_DIR: git,
          GIT_WORK_TREE: worktree,
        })
        .quiet()
        .nothrow()
      // Configure git to not convert line endings on Windows
      await $`git --git-dir ${git} config core.autocrlf false`.env(env).quiet().nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} --work-tree ${worktree} add .`.env(env).quiet().cwd(Instance.directory).nothrow()
    const hash = await $`git --git-dir ${git} --work-tree ${worktree} write-tree`
      .env(env)
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git, worktree })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    await $`git --git-dir ${git} --work-tree ${worktree} add .`.env(env).quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .env(env)
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

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
        .map((x) => path.join(worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    const result =
      await $`git --git-dir ${git} --work-tree ${worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${worktree} checkout-index -a -f`
        .env(env)
        .quiet()
        .cwd(worktree)
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
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const relativePath = path.relative(worktree, file)
        const pathspec = relativePath.startsWith("..") ? file : relativePath
        const result = await $`git --git-dir ${git} --work-tree ${worktree} checkout ${item.hash} -- ${pathspec}`
          .env(env)
          .quiet()
          .cwd(worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${worktree} ls-tree ${item.hash} -- ${relativePath}`
              .env(env)
              .quiet()
              .cwd(worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    await $`git --git-dir ${git} --work-tree ${worktree} add .`.env(env).quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${worktree} diff --no-ext-diff ${hash} -- .`
        .env(env)
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

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

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const worktree = await worktreeRoot()
    const env = { ...process.env, GIT_INDEX_FILE: indexFile(git, worktree) }
    const result: FileDiff[] = []
    for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .env(env)
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${worktree} show ${from}:${file}`
            .env(env)
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${worktree} show ${to}:${file}`
            .env(env)
            .quiet()
            .nothrow()
            .text()
      result.push({
        file,
        before,
        after,
        additions: parseInt(additions),
        deletions: parseInt(deletions),
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }

  function indexFile(git: string, worktree: string) {
    const key = Bun.hash.xxHash64(worktree).toString(16)
    return path.join(git, `index-${key}`)
  }

  async function worktreeRoot() {
    const result = await $`git rev-parse --show-toplevel`.quiet().nothrow().cwd(Instance.directory)
    if (result.exitCode !== 0) return Instance.worktree
    const resolved = result.text().trim()
    if (!resolved) return Instance.worktree
    return path.resolve(Instance.directory, resolved)
  }
}
