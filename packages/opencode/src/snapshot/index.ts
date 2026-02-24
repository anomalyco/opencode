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
import { EOL } from "os"
import { readNull } from "../util/stream"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const sizeThreshold = 1 * 1024 * 1024 * 1024 // 1 GB

  type Env = Record<string, string | undefined>
  type Oversized = {
    failed: boolean
    count: number
    sample: string[]
  }
  type Spawned = {
    exitCode: number
    stderr: string
    signalCode: number | string | null
  }
  type SpawnOptions = Omit<NonNullable<Parameters<typeof Bun.spawn>[1]>, "cwd" | "env"> & {
    input?: string
  }

  export type Cleanup = {
    status: "gc" | "reset" | "skipped" | "failed"
    reason?: "vcs" | "client" | "disabled" | "missing" | "reset" | "gc"
    count?: number
    threshold?: number
    sample?: string[]
    prune?: string
    exitCode?: number
    stderr?: string
    error?: string
  }

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: async () => {
        await cleanup()
      },
      scope: "instance",
    })
  }

  export async function cleanup(input?: { findOversized?: (env: Env) => Promise<Oversized> }): Promise<Cleanup> {
    if (Instance.project.vcs !== "git") {
      return {
        status: "skipped",
        reason: "vcs",
      }
    }
    if (Flag.OPENCODE_CLIENT === "acp") {
      return {
        status: "skipped",
        reason: "client",
      }
    }
    const cfg = await Config.get()
    if (cfg.snapshot === false) {
      return {
        status: "skipped",
        reason: "disabled",
      }
    }
    const git = gitdir()
    const env = gitenv(git)
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
      return {
        status: "skipped",
        reason: "missing",
      }
    }
    const oversized = await (input?.findOversized ?? findOversizedObjects)(env)
    if (oversized.failed) {
      log.warn("cleanup oversized scan failed, continuing with gc")
    }
    if (!oversized.failed && oversized.count > 0) {
      log.warn("cleanup reset snapshot due to oversized objects", {
        count: oversized.count,
        threshold: sizeThreshold,
        sample: oversized.sample,
      })
      const resetError = await fs
        .rm(git, { recursive: true, force: true })
        .then(() => undefined)
        .catch((error) => error)
      if (resetError) {
        const error = resetError instanceof Error ? resetError.message : String(resetError)
        log.warn("cleanup failed to reset snapshot", { error })
        return {
          status: "failed",
          reason: "reset",
          error,
        }
      }
      log.info("cleanup reset snapshot")
      return {
        status: "reset",
        count: oversized.count,
        threshold: sizeThreshold,
        sample: oversized.sample,
      }
    }
    const output = await spawn(["git", "gc", `--prune=${prune}`], env, {
      // git gc --prune can run very slowly and use lots of memory
      // when snapshot repos bloat with unfiltered large files.
      timeout: 60_000,
    })
    if (output.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: output.exitCode,
        signalCode: output.signalCode,
        stderr: output.stderr,
      })
      return {
        status: "failed",
        reason: "gc",
        exitCode: output.exitCode,
        prune,
        stderr: output.stderr,
      }
    }
    log.info("cleanup", { prune })
    return {
      status: "gc",
      prune,
    }
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
    await gitAddFiltered(git)
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
    await gitAddFiltered(git)
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
    await gitAddFiltered(git)
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

  function gitenv(git: string): Env {
    return {
      ...process.env,
      GIT_DIR: git,
      GIT_WORK_TREE: Instance.worktree,
    }
  }

  async function spawn(cmds: string[], env: Env, options?: SpawnOptions): Promise<Spawned> {
    const { input, ...opts } = options ?? {}

    try {
      const proc = Bun.spawn(cmds, {
        cwd: Instance.directory,
        env,
        stdout: "ignore",
        stderr: "pipe",
        ...opts,
        stdin: input === undefined ? opts.stdin : "pipe",
      })

      if (input !== undefined && proc.stdin && typeof proc.stdin !== "number") {
        proc.stdin.write(input)
        proc.stdin.end()
      }

      const stderr = proc.stderr instanceof ReadableStream ? new Response(proc.stderr).text() : Promise.resolve("")
      const exitCode = await proc.exited

      return {
        exitCode,
        stderr: (await stderr).trim(),
        signalCode: proc.signalCode,
      }
    } catch (error) {
      return {
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        signalCode: null,
      }
    }
  }

  async function spawnPathspec(
    cmds: string[],
    env: Env,
    files: string[],
    options?: Omit<SpawnOptions, "stdin" | "input">,
  ): Promise<Spawned> {
    if (files.length === 0) {
      return {
        exitCode: 0,
        stderr: "",
        signalCode: null,
      }
    }

    return spawn([...cmds, "--pathspec-from-file=-", "--pathspec-file-nul"], env, {
      ...options,
      input: `${files.join("\0")}\0`,
    })
  }

  async function gitAddFiltered(git: string): Promise<string[]> {
    const env = gitenv(git)
    await syncExclude(git)

    // -N (`--intent-to-add`) records new paths without staging file contents.
    const intent = await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true add -N -- .`
      .cwd(Instance.directory)
      .env(env)
      .quiet()
      .nothrow()
    if (intent.exitCode !== 0) {
      log.warn("git add -N failed", { exitCode: intent.exitCode, stderr: intent.stderr.toString() })
      return []
    }

    const stagedFiles = await listStagedFiles(env).catch((err) => {
      log.warn("failed to list staged files", { error: err })
      return [] as string[]
    })

    if (stagedFiles.length === 0) {
      log.info("no files to stage")
      return []
    }

    const largeFiles = await findLargeFiles(stagedFiles)
    await unstageAndExclude(env, largeFiles)

    const large = new Set(largeFiles)
    const filesWithoutLarge = stagedFiles.filter((file) => !large.has(file))
    const addOutput = await spawnPathspec(
      ["git", "-c", "core.autocrlf=false", "-c", "core.longpaths=true", "-c", "core.symlinks=true", "add"],
      env,
      filesWithoutLarge,
    )
    if (addOutput.exitCode !== 0) {
      log.warn("git add failed", { exitCode: addOutput.exitCode, stderr: addOutput.stderr })
    }

    return filesWithoutLarge
  }

  async function listStagedFiles(env: Env): Promise<string[]> {
    const output =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true diff --name-only -z --diff-filter=AMD -- .`
        .cwd(Instance.directory)
        .env(env)
        .quiet()

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

    async function execGitRmCached() {
      const output = await spawnPathspec(
        [
          "git",
          "-c",
          "core.autocrlf=false",
          "-c",
          "core.longpaths=true",
          "-c",
          "core.symlinks=true",
          "rm",
          "--cached",
          "--ignore-unmatch",
        ],
        env,
        files,
        {
          stderr: "ignore",
        },
      )

      if (output.exitCode !== 0) {
        log.warn("git rm --cached failed", { code: output.exitCode })
      }
    }

    async function updateGitExclude() {
      const exclude = path.join(gitdir(), "info", "exclude")
      await fs.mkdir(path.dirname(exclude), { recursive: true })
      const current = await fs.readFile(exclude, "utf8").catch(() => "")
      const existing = new Set(current.split(EOL).filter(Boolean))
      const added = files.map(ignoreEscape).filter((file) => !existing.has(file))
      if (added.length === 0) return
      const base = current.length === 0 || current.endsWith(EOL) ? current : `${current}${EOL}`
      await fs.writeFile(exclude, `${base}${added.join(EOL)}${EOL}`)
    }

    log.info("removing large files from snapshot", { files })
    await Promise.all([execGitRmCached(), updateGitExclude()])
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

  async function findOversizedObjects(env: Env): Promise<Oversized> {
    const proc = Bun.spawn(
      ["git", "cat-file", "-Z", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      {
        cwd: Instance.directory,
        env,
        stdout: "pipe",
        stderr: "ignore",
      },
    )
    let count = 0
    const sample: string[] = []

    for await (const line of readNull(proc.stdout)) {
      const [hash, type, raw] = line.split(" ")
      if (!hash || type !== "blob" || !raw) continue
      const size = Number.parseInt(raw, 10)
      if (!Number.isFinite(size) || size <= sizeThreshold) continue
      count += 1
      if (sample.length < 5) sample.push(`${hash}:${size}`)
    }

    const code = await proc.exited
    if (code !== 0) {
      log.warn("git cat-file failed", { exitCode: code })
      return {
        failed: true,
        count: 0,
        sample: [] as string[],
      }
    }

    return {
      failed: false,
      count,
      sample,
    }
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
}
