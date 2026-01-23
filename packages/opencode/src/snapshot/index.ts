import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"

  // Helper to run raw commands using Bun.spawn (works better with non-ASCII paths on Windows)
  async function gitSpawnRaw(
    args: string[],
    cwd: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    return { exitCode, stdout, stderr }
  }

  // Helper to run git commands with --git-dir and --work-tree using Bun.spawn
  async function gitSpawn(
    args: string[],
    cwd: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const git = gitdir()
    const fullArgs = ["git", "--git-dir", git, "--work-tree", Instance.worktree, ...args]
    return gitSpawnRaw(fullArgs, cwd)
  }

  // Helper for git commands with extra config options
  async function gitSpawnWithConfig(
    config: string[],
    args: string[],
    cwd: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const git = gitdir()
    const configArgs = config.flatMap((c) => ["-c", c])
    const fullArgs = ["git", ...configArgs, "--git-dir", git, "--work-tree", Instance.worktree, ...args]
    return gitSpawnRaw(fullArgs, cwd)
  }

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
    const result = await gitSpawn(["gc", `--prune=${prune}`], Instance.directory)
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
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
      // Use Bun.spawn for Windows non-ASCII path compatibility
      await gitSpawnRaw(["git", "init", "--bare", git], Instance.worktree)
      await gitSpawnRaw(["git", "--git-dir", git, "config", "core.autocrlf", "false"], Instance.worktree)
      log.info("initialized")
    }
    // Use Bun.spawn instead of $ template for Windows non-ASCII path compatibility
    await gitSpawn(["add", "."], Instance.directory)
    const result = await gitSpawn(["write-tree"], Instance.directory)
    const hash = result.stdout.trim()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    await gitSpawn(["add", "."], Instance.directory)
    const result = await gitSpawnWithConfig(
      ["core.autocrlf=false"],
      ["diff", "--no-ext-diff", "--name-only", hash, "--", "."],
      Instance.directory
    )

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.stdout
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => unquote(x))
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    // Run read-tree and checkout-index as separate commands
    const readTreeResult = await gitSpawn(["read-tree", snapshot], Instance.worktree)
    if (readTreeResult.exitCode !== 0) {
      log.error("failed to read-tree snapshot", {
        snapshot,
        exitCode: readTreeResult.exitCode,
        stderr: readTreeResult.stderr,
        stdout: readTreeResult.stdout,
      })
      return
    }
    const checkoutResult = await gitSpawn(["checkout-index", "-a", "-f"], Instance.worktree)
    if (checkoutResult.exitCode !== 0) {
      log.error("failed to checkout-index snapshot", {
        snapshot,
        exitCode: checkoutResult.exitCode,
        stderr: checkoutResult.stderr,
        stdout: checkoutResult.stdout,
      })
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        // Convert to relative path with forward slashes for git compatibility on Windows
        const relativePath = path.relative(Instance.worktree, file).replace(/\\/g, "/")
        log.info("reverting", { file, relativePath, hash: item.hash, git })
        // Use Bun.spawn instead of $ template for Windows non-ASCII path compatibility
        const result = await gitSpawn(["checkout", item.hash, "--", relativePath], Instance.worktree)
        if (result.exitCode !== 0) {
          log.info("checkout failed, checking if file exists in snapshot", {
            file,
            relativePath,
            hash: item.hash,
            exitCode: result.exitCode,
            stderr: result.stderr,
          })
          const checkTree = await gitSpawn(["ls-tree", item.hash, "--", relativePath], Instance.worktree)
          const treeOutput = checkTree.stdout.trim()
          log.info("ls-tree result", {
            relativePath,
            exitCode: checkTree.exitCode,
            output: treeOutput,
            stderr: checkTree.stderr,
          })
          if (checkTree.exitCode === 0 && treeOutput) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
              relativePath,
              stderr: result.stderr,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file, relativePath })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    await gitSpawn(["add", "."], Instance.directory)
    const result = await gitSpawnWithConfig(
      ["core.autocrlf=false"],
      ["diff", "--no-ext-diff", hash, "--", "."],
      Instance.worktree
    )

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
      })
      return ""
    }

    return result.stdout.trim()
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
    const result: FileDiff[] = []

    const show = async (hash: string, file: string) => {
      const response = await gitSpawnWithConfig(["core.autocrlf=false"], ["show", `${hash}:${file}`], Instance.worktree)
      if (response.exitCode === 0) return response.stdout
      const stderr = response.stderr
      if (stderr.toLowerCase().includes("does not exist in")) return ""
      return `[DEBUG ERROR] git show ${hash}:${file} failed: ${stderr}`
    }

    const diffResult = await gitSpawnWithConfig(
      ["core.autocrlf=false"],
      ["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", "."],
      Instance.directory
    )

    for (const line of diffResult.stdout.split("\n")) {
      if (!line) continue
      const [additions, deletions, rawFile] = line.split("\t")
      const file = unquote(rawFile)
      const isBinaryFile = additions === "-" && deletions === "-"

      const before = isBinaryFile ? "" : await show(from, file)
      const after = isBinaryFile ? "" : await show(to, file)
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

  /**
   * Decode git's octal-escaped non-ASCII filenames.
   * When core.quotepath=true (default), git outputs non-ASCII filenames like:
   * "\345\205\254\345\205\261\345\207\275\346\225\260.cpp" for "公共函数.cpp"
   */
  export function unquote(filePath: string): string {
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      const quoted = filePath.slice(1, -1)
      const buffer: number[] = []
      for (let i = 0; i < quoted.length; i++) {
        if (quoted[i] === "\\") {
          i++
          // Check for octal escape (e.g. \344)
          if (i + 2 < quoted.length && /^[0-7]{3}$/.test(quoted.slice(i, i + 3))) {
            const octal = quoted.slice(i, i + 3)
            buffer.push(parseInt(octal, 8))
            i += 2
          } else {
            switch (quoted[i]) {
              case "b":
                buffer.push(8)
                break
              case "t":
                buffer.push(9)
                break
              case "n":
                buffer.push(10)
                break
              case "v":
                buffer.push(11)
                break
              case "f":
                buffer.push(12)
                break
              case "r":
                buffer.push(13)
                break
              case '"':
                buffer.push(34)
                break
              case "\\":
                buffer.push(92)
                break
              default:
                buffer.push(quoted.charCodeAt(i))
            }
          }
        } else {
          const charCode = quoted.charCodeAt(i)
          if (charCode < 128) {
            buffer.push(charCode)
          } else {
            const charBuffer = Buffer.from(quoted[i])
            for (const byte of charBuffer) {
              buffer.push(byte)
            }
          }
        }
      }
      return Buffer.from(buffer).toString("utf8")
    }
    return filePath
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
