import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const sizeThreshold = 1 * 1024 * 1024 * 1024 // 1 GB
  type Env = Record<string, string | undefined>

  function gitenv(git = gitdir()): Env {
    return {
      ...process.env,
      GIT_DIR: git,
      GIT_WORK_TREE: Instance.worktree,
    }
  }

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  async function gitAddFiltered() {
    const env = gitenv()

    const intent = await $`git add -N .`.cwd(Instance.directory).env(env).quiet().nothrow()
    if (intent.exitCode !== 0) {
      log.warn("git add -N failed", { exitCode: intent.exitCode, stderr: intent.stderr.toString() })
      return intent
    }

    const stagedFiles = await listStagedFiles(env)
    if (stagedFiles) {
      const largeFiles = await findLargeFiles(stagedFiles)
      await unstageAndExclude(env, largeFiles)
    }

    const addOutput = await $`git add .`.cwd(Instance.directory).env(env).quiet().nothrow()
    if (addOutput.exitCode !== 0) {
      log.warn("git add failed", { exitCode: addOutput.exitCode, stderr: addOutput.stderr.toString() })
    }
    return addOutput
  }

  async function listStagedFiles(env: Env) {
    const output = await $`git ls-files -z --cached --others --exclude-standard`
      .cwd(Instance.directory)
      .env(env)
      .quiet()
      .nothrow()
    if (output.exitCode !== 0) {
      log.warn("git ls-files failed", { exitCode: output.exitCode, stderr: output.stderr.toString() })
      return undefined
    }
    return output.stdout.toString().split("\0").filter(Boolean)
  }

  async function findLargeFiles(files: string[]) {
    const checks = await Promise.all(
      files.map(async (file) => {
        const full = path.join(Instance.worktree, file)
        // Keep symlinks by checking link size, not target size.
        const stat = await fs.lstat(full).catch(() => null)
        return { file, large: stat ? stat.size > sizeThreshold : false }
      }),
    )
    return checks.filter((item) => item.large).map((item) => item.file)
  }

  async function unstageAndExclude(env: Env, files: string[]) {
    if (files.length === 0) return
    log.info("removing large files from snapshot", { files })
    const signal = AbortSignal.timeout(3_000)
    const proc = Bun.spawn(["git", "rm", "--cached", "--ignore-unmatch", "--", ...files], {
      cwd: Instance.directory,
      env,
      signal,
      stdout: "ignore",
      stderr: "ignore",
    })
    const code = await proc.exited
    if (code !== 0) {
      log.warn("git rm --cached failed", { code, timeout: signal.aborted })
    }

    const exclude = path.join(gitdir(), "info", "exclude")
    await fs.mkdir(path.dirname(exclude), { recursive: true })
    const current = await fs.readFile(exclude, "utf8").catch(() => "")
    const existing = new Set(current.split("\n").filter(Boolean))
    const added = files.map(ignoreEscape).filter((file) => !existing.has(file))
    if (added.length === 0) return
    const base = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`
    await fs.writeFile(exclude, `${base}${added.join("\n")}\n`)
  }

  /**
   * Escape gitignore metacharacters so file paths are matched literally.
   * Replaces backslashes, glob chars (* ? [ ]), trailing spaces, and leading #/!.
   */
  function ignoreEscape(file: string) {
    const escaped = file
      .replaceAll("\\", "\\\\")
      .replace(/([*?\[\]])/g, "\\$1")
      .replace(/ +$/g, (spaces) => "\\ ".repeat(spaces.length))
    if (escaped.startsWith("#") || escaped.startsWith("!")) return `\\${escaped}`
    return escaped
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const env = gitenv(git)
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    // git gc --prune can run very slowly and use lots of memory when snapshot repos bloat with unfiltered large files.
    const proc = Bun.spawn(["git", "gc", `--prune=${prune}`], {
      cwd: Instance.directory,
      env,
      stdout: "ignore",
      stderr: "ignore",
      timeout: 120_000,
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode,
        signalCode: proc.signalCode,
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const env = gitenv(git)
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`.env(env).quiet().nothrow()
      // Configure git to not convert line endings on Windows
      await $`git config core.autocrlf false`.env(env).quiet().nothrow()
      await $`git config core.longpaths true`.env(env).quiet().nothrow()
      await $`git config core.symlinks true`.env(env).quiet().nothrow()
      await $`git config core.fsmonitor false`.env(env).quiet().nothrow()
      log.info("initialized")
    }
    await gitAddFiltered()
    const hash = await $`git write-tree`.env(env).quiet().cwd(Instance.directory).nothrow().text()
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
    const env = gitenv(git)
    await gitAddFiltered()
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false diff --no-ext-diff --name-only ${hash} -- .`
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
        .map((x) => path.join(Instance.worktree, x).replaceAll("\\", "/")),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const env = gitenv(git)
    const result =
      await $`git -c core.longpaths=true -c core.symlinks=true read-tree ${snapshot} && git -c core.longpaths=true -c core.symlinks=true checkout-index -a -f`
        .env(env)
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
    const env = gitenv(git)
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git -c core.longpaths=true -c core.symlinks=true checkout ${item.hash} -- ${file}`
          .env(env)
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git -c core.longpaths=true -c core.symlinks=true ls-tree ${item.hash} -- ${relativePath}`
              .env(env)
              .quiet()
              .cwd(Instance.worktree)
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
    const env = gitenv(git)
    await gitAddFiltered()
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false diff --no-ext-diff ${hash} -- .`
        .env(env)
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
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const env = gitenv(git)
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .env(env)
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
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
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true show ${from}:${file}`
            .env(env)
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true show ${to}:${file}`
            .env(env)
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
        status: status.get(file) ?? "modified",
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }

  async function add(git: string) {
    await syncExclude(git)
    await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} add .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
  }

  async function syncExclude(git: string) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    if (!file) {
      await Bun.write(target, "")
      return
    }
    const text = await Bun.file(file)
      .text()
      .catch(() => "")
    await Bun.write(target, text)
  }

  async function excludes() {
    const file = await $`git rev-parse --path-format=absolute --git-path info/exclude`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
      .text()
    if (!file.trim()) return
    const exists = await fs
      .stat(file.trim())
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    return file.trim()
  }
}
