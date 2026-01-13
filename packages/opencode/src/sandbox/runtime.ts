import fs from "fs/promises"
import { spawn, type SpawnOptions, type ChildProcess } from "child_process"
import { SandboxContext } from "./context"
import { Sandbox } from "./provider"
import { Context } from "../util/context"

interface SessionContext {
  sessionId: string
}

const sessionContext = Context.create<SessionContext>("sandbox-session")

/**
 * SandboxRuntime provides file and command execution operations that automatically
 * route to either the local filesystem or a remote sandbox based on the current session context.
 *
 * All tool operations should use these methods instead of direct filesystem calls.
 */
export const SandboxRuntime = {
  withSession<R>(sessionId: string, fn: () => R): R {
    return sessionContext.provide({ sessionId }, fn)
  },

  getSessionId(): string | undefined {
    try {
      return sessionContext.use().sessionId
    } catch {
      return undefined
    }
  },

  async readFile(path: string): Promise<string> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        try {
          return await sandbox.readFile(path)
        } catch (err) {
          throw new Sandbox.FileError({
            message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
            path,
            operation: "read",
          })
        }
      }
    }
    return fs.readFile(path, "utf-8")
  },

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.readFileBuffer(path)
      }
    }
    const buffer = await fs.readFile(path)
    return new Uint8Array(buffer)
  },

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        try {
          await sandbox.writeFile(path, content)
          return
        } catch (err) {
          throw new Sandbox.FileError({
            message: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
            path,
            operation: "write",
          })
        }
      }
    }
    await fs.writeFile(path, content)
  },

  async exists(path: string): Promise<boolean> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.exists(path)
      }
    }
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  },

  async stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; mtime: Date; size: number } | null> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        const result = await sandbox.exec("stat", ["-c", "%F %Y %s", path])
        if (result.exitCode !== 0) return null
        const [type, mtime, size] = result.stdout.trim().split(" ")
        return {
          isDirectory: () => type === "directory",
          isFile: () => type === "regular file" || type === "regular",
          mtime: new Date(parseInt(mtime) * 1000),
          size: parseInt(size),
        }
      }
    }
    try {
      const stats = await fs.stat(path)
      return {
        isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(),
        mtime: stats.mtime,
        size: stats.size,
      }
    } catch {
      return null
    }
  },

  async readdir(path: string): Promise<string[]> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        const files = await sandbox.listFiles(path)
        return files.map((f) => f.path.split("/").pop() ?? f.path)
      }
    }
    return fs.readdir(path)
  },

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        const args = options?.recursive ? ["-p", path] : [path]
        await sandbox.exec("mkdir", args)
        return
      }
    }
    await fs.mkdir(path, options)
  },

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        await sandbox.deleteFile(path, options)
        return
      }
    }
    await fs.rm(path, options)
  },

  async exec(
    command: string,
    args: string[] = [],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<Sandbox.ExecResult> {
    const sessionId = SandboxRuntime.getSessionId()
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        try {
          return await sandbox.exec(command, args, options)
        } catch (err) {
          throw new Sandbox.ExecError({
            message: `Failed to execute command: ${err instanceof Error ? err.message : String(err)}`,
            command: `${command} ${args.join(" ")}`.trim(),
          })
        }
      }
    }

    const { $ } = await import("bun")
    const startTime = Date.now()
    const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command

    const proc =
      process.platform === "win32"
        ? $`cmd /c ${fullCommand}`.nothrow().cwd(options?.cwd ?? process.cwd()).env(options?.env ?? {})
        : $`bash -lc ${fullCommand}`.nothrow().cwd(options?.cwd ?? process.cwd()).env(options?.env ?? {})

    const result = await proc

    return Sandbox.ExecResult.parse({
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout).trim(),
      stderr: new TextDecoder().decode(result.stderr).trim(),
      durationMs: Date.now() - startTime,
    })
  },

  isRemote(): boolean {
    const sessionId = SandboxRuntime.getSessionId()
    return Boolean(sessionId && SandboxContext.isRemote())
  },
}
