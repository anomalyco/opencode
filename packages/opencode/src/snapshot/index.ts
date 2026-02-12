import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { git, gitLines } from "../util/git"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

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
    const dir = gitdir()
    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await git(["--git-dir", dir, "--work-tree", Instance.worktree, "gc", `--prune=${prune}`], {
      cwd: Instance.directory,
    })
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
    const dir = gitdir()
    if (await fs.mkdir(dir, { recursive: true })) {
      await git(["init"], { cwd: Instance.directory, env: { GIT_DIR: dir, GIT_WORK_TREE: Instance.worktree } })
      // Configure git to not convert line endings on Windows
      await git(["--git-dir", dir, "config", "core.autocrlf", "false"], { cwd: Instance.directory })
      log.info("initialized")
    }
    await git(["--git-dir", dir, "--work-tree", Instance.worktree, "add", "."], { cwd: Instance.directory })
    const result = await git(["--git-dir", dir, "--work-tree", Instance.worktree, "write-tree"], {
      cwd: Instance.directory,
    })
    const hash = await result.text()
    log.info("tracking", { hash: hash.trim(), cwd: Instance.directory, git: dir })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const dir = gitdir()
    await git(["--git-dir", dir, "--work-tree", Instance.worktree, "add", "."], { cwd: Instance.directory })
    const result = await git(
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        "--git-dir",
        dir,
        "--work-tree",
        Instance.worktree,
        "diff",
        "--no-ext-diff",
        "--name-only",
        hash,
        "--",
        ".",
      ],
      { cwd: Instance.directory },
    )

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = await result.text()
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
    const dir = gitdir()
    const r1 = await git(["--git-dir", dir, "--work-tree", Instance.worktree, "read-tree", snapshot], {
      cwd: Instance.worktree,
    })
    if (r1.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: r1.exitCode,
        stderr: r1.stderr.toString(),
        stdout: r1.stdout.toString(),
      })
      return
    }
    const r2 = await git(["--git-dir", dir, "--work-tree", Instance.worktree, "checkout-index", "-a", "-f"], {
      cwd: Instance.worktree,
    })
    if (r2.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: r2.exitCode,
        stderr: r2.stderr.toString(),
        stdout: r2.stdout.toString(),
      })
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const dir = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await git(
          ["--git-dir", dir, "--work-tree", Instance.worktree, "checkout", item.hash, "--", file],
          { cwd: Instance.worktree },
        )
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree = await git(
            ["--git-dir", dir, "--work-tree", Instance.worktree, "ls-tree", item.hash, "--", relativePath],
            { cwd: Instance.worktree },
          )
          if (checkTree.exitCode === 0 && (await checkTree.text()).trim()) {
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
    const dir = gitdir()
    await git(["--git-dir", dir, "--work-tree", Instance.worktree, "add", "."], { cwd: Instance.directory })
    const result = await git(
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        "--git-dir",
        dir,
        "--work-tree",
        Instance.worktree,
        "diff",
        "--no-ext-diff",
        hash,
        "--",
        ".",
      ],
      { cwd: Instance.worktree },
    )

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return (await result.text()).trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const dir = gitdir()
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statusResult = await git(
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        "--git-dir",
        dir,
        "--work-tree",
        Instance.worktree,
        "diff",
        "--no-ext-diff",
        "--name-status",
        "--no-renames",
        from,
        to,
        "--",
        ".",
      ],
      { cwd: Instance.directory },
    )
    const statuses = await statusResult.text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of gitLines(
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.quotepath=false",
        "--git-dir",
        dir,
        "--work-tree",
        Instance.worktree,
        "diff",
        "--no-ext-diff",
        "--no-renames",
        "--numstat",
        from,
        to,
        "--",
        ".",
      ],
      { cwd: Instance.directory },
    )) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await git(
            [
              "-c",
              "core.autocrlf=false",
              "--git-dir",
              dir,
              "--work-tree",
              Instance.worktree,
              "show",
              `${from}:${file}`,
            ],
            { cwd: Instance.directory },
          ).then((r) => r.text())
      const after = isBinaryFile
        ? ""
        : await git(
            ["-c", "core.autocrlf=false", "--git-dir", dir, "--work-tree", Instance.worktree, "show", `${to}:${file}`],
            { cwd: Instance.directory },
          ).then((r) => r.text())
      const added = isBinaryFile ? 0 : parseInt(additions!)
      const deleted = isBinaryFile ? 0 : parseInt(deletions!)
      result.push({
        file: file!,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file!) ?? "modified",
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
