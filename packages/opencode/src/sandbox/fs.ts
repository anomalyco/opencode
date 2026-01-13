import fs from "fs/promises"
import path from "path"
import { SandboxContext } from "./context"
import { Sandbox } from "./provider"

export const SandboxFS = {
  async readFile(filePath: string, sessionId?: string): Promise<string> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.readFile(filePath)
      }
    }
    return fs.readFile(filePath, "utf-8")
  },

  async readFileBuffer(filePath: string, sessionId?: string): Promise<Uint8Array> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.readFileBuffer(filePath)
      }
    }
    const buffer = await fs.readFile(filePath)
    return new Uint8Array(buffer)
  },

  async writeFile(filePath: string, content: string | Uint8Array, sessionId?: string): Promise<void> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        await sandbox.writeFile(filePath, content)
        return
      }
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  },

  async exists(filePath: string, sessionId?: string): Promise<boolean> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.exists(filePath)
      }
    }
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  },

  async listDir(dirPath: string, sessionId?: string): Promise<Sandbox.FileInfo[]> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.listFiles(dirPath)
      }
    }
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map((entry) =>
      Sandbox.FileInfo.parse({
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
      }),
    )
  },

  async deleteFile(filePath: string, options?: { recursive?: boolean }, sessionId?: string): Promise<void> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        await sandbox.deleteFile(filePath, options)
        return
      }
    }
    await fs.rm(filePath, { recursive: options?.recursive ?? false })
  },

  async exec(
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeout?: number
    },
    sessionId?: string,
  ): Promise<Sandbox.ExecResult> {
    if (sessionId && SandboxContext.isRemote()) {
      const sandbox = await SandboxContext.getForSession(sessionId)
      if (sandbox) {
        return sandbox.exec(command, args, options)
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
}
