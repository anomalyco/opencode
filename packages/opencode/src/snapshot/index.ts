import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import { Filesystem } from "../util/filesystem"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
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
      await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
      await $`git --git-dir ${git} config core.quotepath false`.quiet().nothrow()
      log.info("initialized")
    }
    await $`git -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const hash = await $`git -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
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
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
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
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
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
        const relativePath = path.relative(Instance.worktree, file)
        if (!Filesystem.contains(Instance.worktree, file) || path.isAbsolute(relativePath) || relativePath === "") {
          log.warn("skipping file outside worktree", { file, relativePath, worktree: Instance.worktree })
          files.add(file)
          continue
        }
        const gitPath = process.platform === "win32" ? relativePath.replaceAll("\\", "/") : relativePath
        log.info("reverting", { file, gitPath, hash: item.hash })
        const result = await runGitCommand(
          ["checkout", item.hash, "--", gitPath],
          { gitDir: git, workTree: Instance.worktree, cwd: Instance.worktree },
        )
        if (result.exitCode !== 0) {
          const checkTree = await runGitCommand(
            ["ls-tree", item.hash, "--", gitPath],
            { gitDir: git, workTree: Instance.worktree, cwd: Instance.worktree },
          )
          if (checkTree.exitCode === 0 && checkTree.stdout.trim()) {
            log.info("checkout failed, trying git show fallback", { file, gitPath })
            const content = await runGitCommand(
              ["show", `${item.hash}:${gitPath}`],
              { gitDir: git, cwd: Instance.worktree },
            )
            if (content.exitCode === 0) {
              const dir = path.dirname(file)
              await fs.mkdir(dir, { recursive: true })
              await fs.writeFile(file, content.stdoutBuffer)
              log.info("restored file via git show", { file })
            } else {
              log.warn("failed to restore file, keeping current version", {
                file,
                checkoutError: result.stderr,
                showError: content.stderr,
              })
            }
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  interface GitCommandOptions {
    gitDir?: string
    workTree?: string
    cwd?: string
  }

  interface GitCommandResult {
    exitCode: number
    stdout: string
    stderr: string
    stdoutBuffer: Buffer
  }

  async function runGitCommand(args: string[], options: GitCommandOptions): Promise<GitCommandResult> {
    const gitArgs = ["-c", "core.quotepath=false"]
    if (options.gitDir) {
      gitArgs.push("--git-dir", options.gitDir)
    }
    if (options.workTree) {
      gitArgs.push("--work-tree", options.workTree)
    }
    gitArgs.push(...args)

    const proc = Bun.spawn(["git", ...gitArgs], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    const stdoutBuffer = Buffer.from(await new Response(proc.stdout).arrayBuffer())
    const stderr = await new Response(proc.stderr).text()

    return {
      exitCode,
      stdout: stdoutBuffer.toString("utf-8"),
      stderr,
      stdoutBuffer,
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
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
    const result: FileDiff[] = []
    for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
