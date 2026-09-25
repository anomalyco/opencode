import { EventEmitter } from "node:events"
import type { ChildProcess, ExecFileException } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { encodeLaunchCommand, openWindowsApp } from "./windows-app"

type SpawnMode = { kind: "close"; code: number } | { kind: "error"; err: Error }

const spawnErr = (code: string, syscall: string) => {
  const err = new Error(`spawn ${code}`) as ExecFileException & { syscall: string }
  err.code = code
  err.syscall = syscall
  return err
}

const exitErr = (code: number) => {
  const err = new Error(`Command failed with exit code ${code}`) as ExecFileException
  err.code = code
  return err
}

const setup = (execErr: ExecFileException | null, mode: SpawnMode = { kind: "close", code: 0 }) => {
  const calls: { cmd: string; args: string[] }[] = []
  return {
    calls,
    launcher: {
      execFile: (_file: string, _args: string[], done: (err: ExecFileException | null) => void) => {
        setTimeout(() => done(execErr), 0)
        return undefined as never
      },
      spawn: (cmd: string, args: string[]) => {
        calls.push({ cmd, args })
        const emitter = new EventEmitter()
        setTimeout(() => {
          if (mode.kind === "error") emitter.emit("error", mode.err)
          else emitter.emit("close", mode.code)
        }, 0)
        return emitter as unknown as ChildProcess
      },
    },
  }
}

const app = "C:\\Program Files\\Editor\\editor.exe"
const dir = "C:\\Projects\\demo"

describe("openWindowsApp", () => {
  test("resolves without shell fallback on success", async () => {
    const { calls, launcher } = setup(null)
    await openWindowsApp(app, dir, launcher)
    expect(calls).toEqual([])
  })

  test("falls back to encoded Start-Process on spawn failure", async () => {
    const { calls, launcher } = setup(spawnErr("EACCES", "spawn C:\\Program Files\\Editor\\editor.exe"))
    await openWindowsApp(app, dir, launcher)
    expect(calls).toEqual([
      {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encodeLaunchCommand(app, dir)],
      },
    ])
  })

  test("falls back on other spawn-time failures too", async () => {
    const { calls, launcher } = setup(spawnErr("EPERM", "spawn C:\\Program Files\\Editor\\editor.exe"))
    await openWindowsApp(app, dir, launcher)
    expect(calls.length).toBe(1)
  })

  test("rejects numeric exit codes without fallback", async () => {
    const { calls, launcher } = setup(exitErr(3))
    await expect(openWindowsApp(app, dir, launcher)).rejects.toThrow("exit code 3")
    expect(calls).toEqual([])
  })

  test("rejects when the shell fallback exits nonzero", async () => {
    const { launcher } = setup(spawnErr("EACCES", "spawn"), { kind: "close", code: 1 })
    await expect(openWindowsApp(app, dir, launcher)).rejects.toThrow("exited with code 1")
  })

  test("rejects when the shell fallback fails to spawn", async () => {
    const { launcher } = setup(spawnErr("EACCES", "spawn"), { kind: "error", err: new Error("spawn ENOENT") })
    await expect(openWindowsApp(app, dir, launcher)).rejects.toThrow("ENOENT")
  })
})

describe("encodeLaunchCommand", () => {
  test("round-trips through utf-16le base64", async () => {
    const decoded = Buffer.from(encodeLaunchCommand(app, dir), "base64").toString("utf16le")
    expect(decoded).toBe(`Start-Process -FilePath '${app}' -ArgumentList '${dir}'`)
  })

  test("escapes single quotes by doubling them", async () => {
    const decoded = Buffer.from(encodeLaunchCommand(app, "C:\\Users\\owner's\\project"), "base64").toString("utf16le")
    expect(decoded).toContain("C:\\Users\\owner''s\\project")
  })

  test("keeps shell metachars and non-ascii intact for -LiteralPath-free transport", async () => {
    const target = "C:\\100% complete & done 山田"
    const decoded = Buffer.from(encodeLaunchCommand(app, target), "base64").toString("utf16le")
    expect(decoded).toContain(target)
    expect(encodeLaunchCommand(app, target)).toMatch(/^[A-Za-z0-9+/=]+$/)
  })
})