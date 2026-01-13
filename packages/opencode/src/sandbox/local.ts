import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Sandbox } from "./provider"
import { Worktree } from "../worktree"
import { Global } from "../global"
import { Instance as ProjectInstance } from "../project/instance"

function outputText(input: Uint8Array | undefined): string {
  if (!input?.length) return ""
  return new TextDecoder().decode(input).trim()
}

function generateId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

class LocalSandboxInstance implements Sandbox.Instance {
  constructor(public readonly info: Sandbox.Info) {}

  async exec(
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeout?: number
      stdin?: string
    },
  ): Promise<Sandbox.ExecResult> {
    const startTime = Date.now()
    const cwd = options?.cwd ? path.resolve(this.info.workdir, options.cwd) : this.info.workdir

    const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command

    const proc =
      process.platform === "win32"
        ? $`cmd /c ${fullCommand}`.nothrow().cwd(cwd).env(options?.env ?? {})
        : $`bash -lc ${fullCommand}`.nothrow().cwd(cwd).env(options?.env ?? {})

    const result = await proc

    return Sandbox.ExecResult.parse({
      exitCode: result.exitCode,
      stdout: outputText(result.stdout),
      stderr: outputText(result.stderr),
      durationMs: Date.now() - startTime,
    })
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = path.resolve(this.info.workdir, filePath)
    try {
      return await fs.readFile(fullPath, "utf-8")
    } catch (err) {
      throw new Sandbox.FileError({
        message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        path: filePath,
        operation: "read",
      })
    }
  }

  async readFileBuffer(filePath: string): Promise<Uint8Array> {
    const fullPath = path.resolve(this.info.workdir, filePath)
    try {
      const buffer = await fs.readFile(fullPath)
      return new Uint8Array(buffer)
    } catch (err) {
      throw new Sandbox.FileError({
        message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        path: filePath,
        operation: "read",
      })
    }
  }

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    const fullPath = path.resolve(this.info.workdir, filePath)
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content)
    } catch (err) {
      throw new Sandbox.FileError({
        message: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
        path: filePath,
        operation: "write",
      })
    }
  }

  async deleteFile(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = path.resolve(this.info.workdir, filePath)
    try {
      await fs.rm(fullPath, { recursive: options?.recursive ?? false })
    } catch (err) {
      throw new Sandbox.FileError({
        message: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}`,
        path: filePath,
        operation: "delete",
      })
    }
  }

  async listFiles(dirPath: string): Promise<Sandbox.FileInfo[]> {
    const fullPath = path.resolve(this.info.workdir, dirPath)
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true })
      const results: Sandbox.FileInfo[] = []

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)
        const stat = await fs.stat(path.join(fullPath, entry.name)).catch(() => null)

        results.push(
          Sandbox.FileInfo.parse({
            path: entryPath,
            type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
            size: stat?.size,
            modifiedAt: stat?.mtime.toISOString(),
          }),
        )
      }

      return results
    } catch (err) {
      throw new Sandbox.FileError({
        message: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`,
        path: dirPath,
        operation: "list",
      })
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.resolve(this.info.workdir, filePath)
    try {
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  async snapshot(_name?: string): Promise<Sandbox.Snapshot> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not supported for local sandboxes - use git commits instead",
      sandboxId: this.info.id,
    })
  }

  async stop(): Promise<void> {}


  async terminate(): Promise<void> {
    const result = await $`git worktree remove ${this.info.workdir} --force`
      .quiet()
      .nothrow()
      .cwd(ProjectInstance.worktree)

    if (result.exitCode !== 0) {
      throw new Sandbox.ProviderError({
        message: `Failed to remove worktree: ${outputText(result.stderr)}`,
        provider: "local",
      })
    }
  }

  async getStatus(): Promise<Sandbox.Status> {
    try {
      await fs.access(this.info.workdir)
      return "running"
    } catch {
      return "terminated"
    }
  }

  async waitForStatus(status: Sandbox.Status, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const current = await this.getStatus()
      if (current === status) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Sandbox.TimeoutError({
      message: `Timed out waiting for status: ${status}`,
      timeoutMs,
    })
  }
}

export class LocalSandboxProvider implements Sandbox.Provider {
  readonly type: Sandbox.ProviderType = "local"

  private sandboxes = new Map<string, Sandbox.Info>()

  async create(config: Sandbox.Config): Promise<Sandbox.Instance> {
    try {
      const worktreeInfo = await Worktree.create({ name: config.name })

      const info = Sandbox.Info.parse({
        id: config.id ?? generateId(),
        name: worktreeInfo.name,
        status: "running" as const,
        provider: "local" as const,
        workdir: worktreeInfo.directory,
        createdAt: new Date().toISOString(),
        projectId: config.projectId ?? ProjectInstance.project.id,
        sessionId: config.sessionId,
        metadata: {
          branch: worktreeInfo.branch,
          worktreeName: worktreeInfo.name,
        },
      })

      this.sandboxes.set(info.id, info)
      return new LocalSandboxInstance(info)
    } catch (err) {
      if (err instanceof Worktree.NotGitError) {
        throw new Sandbox.CreateError({
          message: "Local sandboxes require a git repository",
          provider: "local",
        })
      }
      if (err instanceof Worktree.CreateFailedError) {
        throw new Sandbox.CreateError({
          message: err.data.message,
          provider: "local",
        })
      }
      throw new Sandbox.CreateError({
        message: err instanceof Error ? err.message : String(err),
        provider: "local",
      })
    }
  }

  async get(id: string): Promise<Sandbox.Instance | undefined> {
    const info = this.sandboxes.get(id)
    if (!info) return undefined
    return new LocalSandboxInstance(info)
  }

  async list(filter?: {
    projectId?: string
    sessionId?: string
    status?: Sandbox.Status
  }): Promise<Sandbox.Info[]> {
    let results = Array.from(this.sandboxes.values())

    if (filter?.projectId) {
      results = results.filter((s) => s.projectId === filter.projectId)
    }
    if (filter?.sessionId) {
      results = results.filter((s) => s.sessionId === filter.sessionId)
    }
    if (filter?.status) {
      results = results.filter((s) => s.status === filter.status)
    }

    return results
  }

  async terminate(id: string): Promise<void> {
    const instance = await this.get(id)
    if (!instance) {
      throw new Sandbox.NotFoundError({
        id,
        message: `Sandbox not found: ${id}`,
      })
    }
    await instance.terminate()
    this.sandboxes.delete(id)
  }

  async terminateAll(filter?: { projectId?: string; sessionId?: string }): Promise<number> {
    const toTerminate = await this.list(filter)
    let count = 0
    for (const info of toTerminate) {
      try {
        await this.terminate(info.id)
        count++
      } catch {}
    }
    return count
  }

  async restore(_snapshotId: string, _config?: Partial<Sandbox.Config>): Promise<Sandbox.Instance> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not supported for local sandboxes",
      snapshotId: _snapshotId,
    })
  }

  async listSnapshots(_filter?: {
    sandboxId?: string
    projectId?: string
  }): Promise<Sandbox.Snapshot[]> {
    return []
  }

  async deleteSnapshot(_snapshotId: string): Promise<void> {
    throw new Sandbox.SnapshotError({
      message: "Snapshots not supported for local sandboxes",
      snapshotId: _snapshotId,
    })
  }

  async healthCheck(): Promise<boolean> {
    const result = await $`git --version`.quiet().nothrow()
    return result.exitCode === 0
  }
}

export function createLocalProvider(): LocalSandboxProvider {
  return new LocalSandboxProvider()
}
