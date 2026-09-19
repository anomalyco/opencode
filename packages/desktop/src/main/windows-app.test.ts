import { EventEmitter } from "node:events"
import type { ChildProcess, ExecFileException } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { openWindowsApp } from "./windows-app"

const accessDenied = () => {
  const err = new Error("spawn EACCES") as ExecFileException
  err.code = "EACCES"
  return err
}

const missing = () => {
  const err = new Error("spawn ENOENT") as ExecFileException
  err.code = "ENOENT"
  return err
}

const setup = (execErr: ExecFileException | null, spawnErr?: Error) => {
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
        const emitter = new EventEmitter() as EventEmitter & { unref: () => void }
        emitter.unref = () => {}
        setTimeout(() => emitter.emit(spawnErr ? "error" : "spawn", spawnErr), 0)
        return emitter as unknown as ChildProcess
      },
    },
  }
}

describe("openWindowsApp", () => {
  test("resolves without shell fallback on success", async () => {
    const { calls, launcher } = setup(null)
    await openWindowsApp("C:\\Apps\\editor.exe", "C:\\Projects\\demo", launcher)
    expect(calls).toEqual([])
  })

  test("falls back to cmd start on EACCES", async () => {
    const { calls, launcher } = setup(accessDenied())
    await openWindowsApp("C:\\Program Files\\Editor\\editor.exe", "C:\\Projects\\demo", launcher)
    expect(calls).toEqual([
      {
        cmd: "cmd.exe",
        args: ["/d", "/c", "start", "", "C:\\Program Files\\Editor\\editor.exe", "C:\\Projects\\demo"],
      },
    ])
  })

  test("rejects other errors without shell fallback", async () => {
    const { calls, launcher } = setup(missing())
    await expect(openWindowsApp("C:\\Apps\\editor.exe", "C:\\Projects\\demo", launcher)).rejects.toThrow("ENOENT")
    expect(calls).toEqual([])
  })

  test("rejects when the shell fallback fails to spawn", async () => {
    const { launcher } = setup(accessDenied(), missing())
    await expect(openWindowsApp("C:\\Apps\\editor.exe", "C:\\Projects\\demo", launcher)).rejects.toThrow("ENOENT")
  })
})