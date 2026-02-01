import { $ } from "bun"
import { spawn } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Config } from "../config/config"
import { Global } from "../global"
import { Storage } from "../storage/storage"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

export namespace Repo {
  const log = Log.create({ service: "repo" })

  export const Info = z
    .object({
      id: z.string(),
      path: z.string(),
      name: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "Repo",
    })
  export type Info = z.infer<typeof Info>

  export const CloneProgress = z
    .object({
      received_objects: z.number(),
      total_objects: z.number(),
      received_bytes: z.number(),
      indexed_objects: z.number(),
      total_deltas: z.number(),
      indexed_deltas: z.number(),
    })
    .meta({
      ref: "RepoCloneProgress",
    })
  export type CloneProgress = z.infer<typeof CloneProgress>

  export const BranchInfo = z
    .object({
      name: z.string(),
      current: z.boolean(),
      remote: z.boolean(),
    })
    .meta({
      ref: "RepoBranch",
    })
  export type BranchInfo = z.infer<typeof BranchInfo>

  export const CloneCredentials = z
    .union([
      z.object({
        type: z.literal("ssh_passphrase"),
        passphrase: z.string(),
        key_path: z.string().optional(),
      }),
      z.object({
        type: z.literal("github_pat"),
        token: z.string(),
      }),
      z.object({
        type: z.literal("https_basic"),
        username: z.string(),
        password: z.string(),
      }),
    ])
    .meta({
      ref: "RepoCloneCredentials",
    })
  export type CloneCredentials = z.infer<typeof CloneCredentials>

  export const CloneErrorInfo = z
    .object({
      message: z.string(),
      help_steps: z.string().array().optional(),
      auth_type: z.enum(["ssh", "github_pat", "https_basic"]).optional(),
      can_retry_with_credentials: z.boolean().optional(),
    })
    .meta({
      ref: "RepoCloneError",
    })
  export type CloneErrorInfo = z.infer<typeof CloneErrorInfo>

  export const InvalidRecordInfo = z.object({
    message: z.string(),
    code: z.string().optional(),
  })
  export type InvalidRecordInfo = z.infer<typeof InvalidRecordInfo>

  export class CloneError extends Error {
    info: CloneErrorInfo

    constructor(info: CloneErrorInfo) {
      super(info.message)
      this.info = info
    }
  }

  export class InvalidRecordError extends Error {
    info: InvalidRecordInfo

    constructor(info: InvalidRecordInfo) {
      super(info.message)
      this.info = info
    }
  }

  const DEFAULT_PROGRESS: CloneProgress = {
    received_objects: 0,
    total_objects: 0,
    received_bytes: 0,
    indexed_objects: 0,
    total_deltas: 0,
    indexed_deltas: 0,
  }

  function resolveWorkspaceRoot(root?: string) {
    if (!root) return path.join(Global.Path.home, "opencode")
    if (root.startsWith("~/")) return path.join(Global.Path.home, root.slice(2))
    return root
  }

  function normalizePath(input: string) {
    const expanded = input.startsWith("~/") ? path.join(Global.Path.home, input.slice(2)) : input
    return Filesystem.normalizePath(path.resolve(expanded))
  }

  function sanitizeCloneUrl(url: string) {
    return url.replace(/(https?:\/\/)([^@/]+)@/gi, "$1")
  }

  function sanitizeOutput(output: string) {
    return output.replace(/https?:\/\/[^@\s]+@/gi, "https://")
  }

  function extractRepoName(url: string) {
    const trimmed = url
      .trim()
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
    const slash = trimmed.split("/").filter(Boolean)
    const name = slash[slash.length - 1] || trimmed.split(":").pop()
    if (!name || name.includes("/")) {
      throw new CloneError({
        message: "Could not extract repository name from URL",
        help_steps: ["Check that the URL is a valid Git clone URL."],
        can_retry_with_credentials: false,
      })
    }
    return name
  }

  function parseBytes(text?: string) {
    if (!text) return 0
    const match = text.trim().match(/^([0-9.]+)\s*([a-zA-Z]+)$/)
    if (!match) return 0
    const value = Number(match[1])
    const unit = match[2].toLowerCase()
    if (Number.isNaN(value)) return 0
    if (unit.startsWith("kb")) return Math.round(value * 1024)
    if (unit.startsWith("mb")) return Math.round(value * 1024 * 1024)
    if (unit.startsWith("gb")) return Math.round(value * 1024 * 1024 * 1024)
    return Math.round(value)
  }

  function parseProgressLine(line: string, current: CloneProgress) {
    const receiving = line.match(/Receiving objects:\s+\d+%\s+\((\d+)\/(\d+)\)(?:,\s+([0-9.]+\s+\w+))?/i)
    if (receiving) {
      return {
        ...current,
        received_objects: Number(receiving[1]),
        total_objects: Number(receiving[2]),
        received_bytes: parseBytes(receiving[3]),
      }
    }

    const counting = line.match(/Counting objects:\s+\d+%\s+\((\d+)\/(\d+)\)/i)
    if (counting) {
      return {
        ...current,
        indexed_objects: Number(counting[1]),
        total_objects: Math.max(current.total_objects, Number(counting[2])),
      }
    }

    const resolving = line.match(/Resolving deltas:\s+\d+%\s+\((\d+)\/(\d+)\)/i)
    if (resolving) {
      return {
        ...current,
        indexed_deltas: Number(resolving[1]),
        total_deltas: Number(resolving[2]),
      }
    }

    return undefined
  }

  function classifyCloneError(output: string): CloneErrorInfo {
    const normalized = output.toLowerCase()
    if (normalized.includes("permission denied") && normalized.includes("publickey")) {
      return {
        message: "SSH authentication failed. Check your SSH key and repository access.",
        help_steps: [
          "Ensure your SSH key is added to the ssh-agent.",
          "Confirm the repository exists and you have access.",
        ],
        auth_type: "ssh",
        can_retry_with_credentials: true,
      }
    }
    if (normalized.includes("authentication failed") || normalized.includes("fatal: could not read username")) {
      return {
        message: "HTTPS authentication failed. Check your username or token.",
        help_steps: [
          "Verify your GitHub personal access token or username/password.",
          "Ensure the repository URL uses HTTPS.",
        ],
        auth_type: normalized.includes("github") ? "github_pat" : "https_basic",
        can_retry_with_credentials: true,
      }
    }
    return {
      message: output || "Clone failed.",
      help_steps: ["Verify the repository URL and your network connection."],
      can_retry_with_credentials: false,
    }
  }

  async function ensureGitRepo(repoPath: string) {
    const isDir = await Filesystem.isDir(repoPath)
    if (!isDir) {
      throw new CloneError({
        message: "Path does not exist or is not a directory.",
        help_steps: ["Provide a valid directory path to a git repository."],
        can_retry_with_credentials: false,
      })
    }
    const result = await $`git rev-parse --is-inside-work-tree`.quiet().nothrow().cwd(repoPath)
    if (result.exitCode !== 0 || result.text().trim() !== "true") {
      throw new CloneError({
        message: "Path is not a git repository.",
        help_steps: ["Run `git init` in the directory or choose a valid git repository."],
        can_retry_with_credentials: false,
      })
    }
  }

  export async function getCloneDestination(input: { url: string; workspaceRoot?: string }) {
    const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot ?? (await Config.get()).workspace?.root)
    const repoName = extractRepoName(input.url)
    return {
      workspaceRoot,
      destination: path.join(workspaceRoot, repoName),
      name: repoName,
    }
  }

  async function prepareCloneEnv(credentials?: CloneCredentials, url?: string) {
    const env = { ...process.env } as Record<string, string>
    env.GIT_TERMINAL_PROMPT = "0"
    let cloneUrl = url
    let cleanup: (() => Promise<void>) | undefined

    if (!credentials || !url) {
      return { env, cloneUrl, cleanup }
    }

    if (credentials.type === "github_pat") {
      if (!url.startsWith("http")) {
        throw new CloneError({
          message: "Personal access tokens require an HTTPS clone URL.",
          help_steps: ["Use the HTTPS clone URL from GitHub.", "Retry with your personal access token."],
          auth_type: "github_pat",
          can_retry_with_credentials: true,
        })
      }
      const parsed = new URL(url)
      parsed.username = "x-access-token"
      parsed.password = credentials.token
      cloneUrl = parsed.toString()
    }

    if (credentials.type === "https_basic") {
      if (!url.startsWith("http")) {
        throw new CloneError({
          message: "HTTPS credentials require an HTTPS clone URL.",
          help_steps: ["Use the HTTPS clone URL from your git provider."],
          auth_type: "https_basic",
          can_retry_with_credentials: true,
        })
      }
      const parsed = new URL(url)
      parsed.username = credentials.username
      parsed.password = credentials.password
      cloneUrl = parsed.toString()
    }

    if (credentials.type === "ssh_passphrase") {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-ssh-"))
      const script = path.join(dir, "askpass.sh")
      await fs.writeFile(script, `#!/bin/sh\necho "${credentials.passphrase.replace(/"/g, '\\"')}"\n`)
      await fs.chmod(script, 0o700)
      env.SSH_ASKPASS = script
      env.SSH_ASKPASS_REQUIRE = "force"
      env.DISPLAY = env.DISPLAY ?? "1"
      if (credentials.key_path) {
        env.GIT_SSH_COMMAND = `ssh -i ${credentials.key_path} -o IdentitiesOnly=yes`
      }
      cleanup = async () => {
        await fs.rm(dir, { recursive: true, force: true })
      }
    }

    return { env, cloneUrl, cleanup }
  }

  async function writeRepo(repo: Info) {
    await Storage.write(["repo", repo.id], repo)
    return repo
  }

  async function findByPath(repoPath: string) {
    const keys = await Storage.list(["repo"])
    for (const key of keys) {
      const repo = await Storage.read<Info>(key).catch(() => undefined)
      if (repo && repo.path === repoPath) return repo
    }
    return undefined
  }

  export async function list() {
    const keys = await Storage.list(["repo"])
    const repos = await Promise.all(keys.map((x) => Storage.read<Info>(x)))
    const valid: Info[] = []
    for (const repo of repos) {
      if (await Filesystem.exists(repo.path)) valid.push(repo)
    }
    return valid
  }

  export async function get(repoId: string) {
    let record: unknown
    try {
      record = await Storage.read<Info>(["repo", repoId])
    } catch (error) {
      if (error instanceof Storage.InvalidDataError) {
        throw new InvalidRecordError({
          message: "Repository record is malformed. Remove and re-add the repository.",
          code: "repo_malformed",
        })
      }
      throw error
    }

    const parsed = Info.safeParse(record)
    if (!parsed.success) {
      const data = record as { path?: unknown } | null
      const missingPath = !data || typeof data !== "object" || typeof data.path !== "string" || !data.path.trim()
      throw new InvalidRecordError({
        message: missingPath
          ? "Repository record is missing a path. Remove and re-add the repository."
          : "Repository record is invalid. Remove and re-add the repository.",
        code: missingPath ? "repo_missing_path" : "repo_invalid",
      })
    }

    return parsed.data
  }

  export async function add(input: { path: string; name?: string }) {
    const repoPath = normalizePath(input.path)
    await ensureGitRepo(repoPath)
    const existing = await findByPath(repoPath)
    if (existing) {
      throw new CloneError({
        message: "Repository already exists.",
        help_steps: ["Select the existing repository from the list."],
        can_retry_with_credentials: false,
      })
    }
    const name = input.name?.trim() || path.basename(repoPath)
    const repo: Info = {
      id: crypto.randomUUID(),
      path: repoPath,
      name,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    return writeRepo(repo)
  }

  export async function clone(input: {
    url: string
    branch?: string
    credentials?: CloneCredentials
    workspaceRoot?: string
  }) {
    const { workspaceRoot, destination, name } = await getCloneDestination({
      url: input.url,
      workspaceRoot: input.workspaceRoot,
    })

    if (await Filesystem.exists(destination)) {
      throw new CloneError({
        message: `Destination already exists: ${destination}`,
        help_steps: ["Remove the existing directory or choose another repository."],
        can_retry_with_credentials: false,
      })
    }

    await fs.mkdir(workspaceRoot, { recursive: true })
    const { env, cloneUrl, cleanup } = await prepareCloneEnv(input.credentials, input.url)
    const args = ["clone", "--recurse-submodules"]
    if (input.branch) args.push("--branch", input.branch)
    args.push(cloneUrl ?? input.url, destination)

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn("git", args, { cwd: workspaceRoot, env })
      let stdout = ""
      let stderr = ""
      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      proc.on("error", reject)
      proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
    }).finally(async () => {
      await cleanup?.()
    })

    if (result.code !== 0) {
      const output = sanitizeOutput([result.stderr, result.stdout].filter(Boolean).join("\n"))
      throw new CloneError(classifyCloneError(output))
    }

    const repo: Info = {
      id: crypto.randomUUID(),
      path: destination,
      name,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    await writeRepo(repo)

    return { repo, message: `Cloned to ${destination}` }
  }

  export async function cloneWithProgress(input: {
    url: string
    branch?: string
    credentials?: CloneCredentials
    workspaceRoot?: string
    onProgress: (progress: CloneProgress) => void
  }) {
    const { workspaceRoot, destination, name } = await getCloneDestination({
      url: input.url,
      workspaceRoot: input.workspaceRoot,
    })

    if (await Filesystem.exists(destination)) {
      throw new CloneError({
        message: `Destination already exists: ${destination}`,
        help_steps: ["Remove the existing directory or choose another repository."],
        can_retry_with_credentials: false,
      })
    }

    await fs.mkdir(workspaceRoot, { recursive: true })
    const { env, cloneUrl, cleanup } = await prepareCloneEnv(input.credentials, input.url)

    const args = ["clone", "--progress", "--recurse-submodules"]
    if (input.branch) args.push("--branch", input.branch)
    args.push(cloneUrl ?? input.url, destination)

    const progress = { ...DEFAULT_PROGRESS }
    const proc = spawn("git", args, {
      cwd: workspaceRoot,
      env,
    })

    let stderrBuffer = ""
    let stdoutBuffer = ""
    let progressBuffer = ""

    const handleChunk = (chunk: Buffer) => {
      progressBuffer += chunk.toString()
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() ?? ""
      for (const line of lines) {
        const next = parseProgressLine(line, progress)
        if (!next) continue
        Object.assign(progress, next)
        input.onProgress({ ...progress })
      }
    }

    proc.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString()
      handleChunk(chunk)
    })
    proc.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString()
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      proc.on("error", reject)
      proc.on("close", (code) => resolve(code ?? 1))
    }).finally(async () => {
      await cleanup?.()
    })

    if (exitCode !== 0) {
      const output = sanitizeOutput([stderrBuffer, stdoutBuffer].filter(Boolean).join("\n"))
      throw new CloneError(classifyCloneError(output))
    }

    const repo: Info = {
      id: crypto.randomUUID(),
      path: destination,
      name,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    await writeRepo(repo)

    return { repo, message: `Cloned to ${destination}` }
  }

  export async function listBranches(repo: Info) {
    await ensureGitRepo(repo.path)
    const current = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(repo.path).text()
    const output = await $`git ${["branch", "--all", "--format=%(refname:short)"]}`
      .quiet()
      .nothrow()
      .cwd(repo.path)
      .text()
    const names = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.endsWith("/HEAD"))

    const branches = new Map<string, BranchInfo>()
    for (const name of names) {
      const remote = name.startsWith("origin/")
      const cleaned = remote ? name.replace(/^origin\//, "") : name
      if (!cleaned) continue
      if (!branches.has(cleaned)) {
        branches.set(cleaned, { name: cleaned, current: cleaned === current.trim(), remote })
      }
    }
    return {
      current: current.trim() || undefined,
      branches: Array.from(branches.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  export async function isDirty(repo: Info) {
    const status = await $`git status --porcelain`.quiet().nothrow().cwd(repo.path).text()
    const lines = status
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
    return {
      dirty: lines.length > 0,
      files: lines.map((line) => line.slice(3)),
    }
  }

  export async function checkoutBranch(repo: Info, branch: string, force?: boolean) {
    const { dirty, files } = await isDirty(repo)
    if (dirty && !force) {
      return { dirty: true, files }
    }

    const localBranch = await $`git show-ref --verify --quiet refs/heads/${branch}`.quiet().nothrow().cwd(repo.path)
    if (localBranch.exitCode === 0) {
      const args = ["checkout"]
      if (force) args.push("-f")
      args.push(branch)
      const result = await $`git ${args}`.quiet().nothrow().cwd(repo.path)
      if (result.exitCode !== 0) {
        throw new CloneError({ message: sanitizeOutput(result.stderr?.toString() ?? "Failed to checkout branch.") })
      }
      return { dirty: false }
    }

    const remoteBranch = await $`git show-ref --verify --quiet refs/remotes/origin/${branch}`
      .quiet()
      .nothrow()
      .cwd(repo.path)
    const args = ["checkout"]
    if (force) args.push("-f")
    if (remoteBranch.exitCode === 0) {
      args.push("-b", branch, "--track", `origin/${branch}`)
    } else {
      args.push(branch)
    }
    const result = await $`git ${args}`.quiet().nothrow().cwd(repo.path)
    if (result.exitCode !== 0) {
      throw new CloneError({ message: sanitizeOutput(result.stderr?.toString() ?? "Failed to checkout branch.") })
    }
    return { dirty: false }
  }

  export function audit(action: string, details: Record<string, unknown>) {
    log.info(action, details)
  }

  export function safeCloneUrl(url: string) {
    return sanitizeCloneUrl(url)
  }
}
