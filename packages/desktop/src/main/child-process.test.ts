import { beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { APP_PATH_CACHE_LIMIT } from "../app-path-cache"

type ExecFileOptions = {
  windowsHide?: boolean
}

type SpawnOptions = {
  stdio?: string
  windowsHide?: boolean
}

type ExecFileCallback = (error: Error | null, stdout: Buffer, stderr: Buffer) => void

const calls: Array<{ command: string; args: string[]; options: ExecFileOptions }> = []
const spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }> = []
let error: Error | null = null
let output = ""
let spawnThrown: Error | null = null
let spawnError: Error | null = null
let unrefError: Error | null = null
let spawnHandler: (() => void) | undefined

const whereCall = (app: string) => ({ command: "where", args: [app], options: { windowsHide: true } })

void mock.module("node:child_process", () => ({
  execFile: (command: string, args: string[], options: ExecFileOptions, callback: ExecFileCallback) => {
    calls.push({ command, args, options })
    callback(error, Buffer.from(output), Buffer.from(""))
    return undefined
  },
  spawn: (command: string, args: string[], options: SpawnOptions) => {
    if (spawnThrown) throw spawnThrown
    spawnCalls.push({ command, args, options })
    return {
      once(event: "error" | "spawn", callback: (error?: Error) => void) {
        if (event === "error" && spawnError) callback(spawnError)
        if (event === "spawn") spawnHandler = () => callback()
        return this
      },
      unref: mock(() => {
        if (unrefError) throw unrefError
      }),
    }
  },
}))

const { execFileHidden } = await import("./child-process")
const { openPathWithApp } = await import("./child-process")
const { spawnHidden } = await import("./child-process")
const { resolveAppPath } = await import("./apps")

beforeEach(() => {
  calls.length = 0
  spawnCalls.length = 0
  error = null
  output = ""
  spawnThrown = null
  spawnError = null
  unrefError = null
  spawnHandler = undefined
})

function platform(value: NodeJS.Platform) {
  const previous = process.platform
  Object.defineProperty(process, "platform", { value })
  return () => Object.defineProperty(process, "platform", { value: previous })
}

describe("child process helpers", () => {
  test("hides Windows console windows for spawned commands", async () => {
    await execFileHidden("where", ["code"])

    expect(calls).toEqual([whereCall("code")])
  })

  test("preserves spawned command failures", async () => {
    error = new Error("command failed")

    await expect(execFileHidden("where", ["missing"])).rejects.toThrow("command failed")

    expect(calls).toEqual([whereCall("missing")])
  })

  test("launches apps without waiting for them to exit", async () => {
    const launched = spawnHidden("C:\\Tools\\Code.exe", ["C:\\repo"])

    spawnHandler?.()
    await expect(launched).resolves.toBeUndefined()

    expect(spawnCalls).toEqual([
      { command: "C:\\Tools\\Code.exe", args: ["C:\\repo"], options: { stdio: "ignore", windowsHide: true } },
    ])
  })

  test("preserves app launch failures", async () => {
    spawnError = new Error("launch failed")

    await expect(spawnHidden("C:\\Tools\\Missing.exe", ["C:\\repo"])).rejects.toThrow("launch failed")

    expect(spawnCalls).toEqual([
      { command: "C:\\Tools\\Missing.exe", args: ["C:\\repo"], options: { stdio: "ignore", windowsHide: true } },
    ])
  })

  test("preserves synchronous app launch failures", async () => {
    spawnThrown = new Error("spawn failed before events")

    await expect(spawnHidden("C:\\Tools\\Missing.exe", ["C:\\repo"])).rejects.toThrow("spawn failed before events")

    expect(spawnCalls).toEqual([])
  })

  test("rejects when a launched child cannot be unreferenced", async () => {
    unrefError = new Error("unref failed")

    const launched = spawnHidden("C:\\Tools\\Code.exe", ["C:\\repo"])
    spawnHandler?.()

    await expect(launched).rejects.toThrow("unref failed")
    expect(spawnCalls).toEqual([
      { command: "C:\\Tools\\Code.exe", args: ["C:\\repo"], options: { stdio: "ignore", windowsHide: true } },
    ])
  })

  test("uses non-blocking hidden spawn for Windows explicit app opens", async () => {
    const restore = platform("win32")

    try {
      const opened = openPathWithApp("C:\\repo", "C:\\Tools\\Code.exe")
      spawnHandler?.()
      await opened
    } finally {
      restore()
    }

    expect(spawnCalls).toEqual([
      { command: "C:\\Tools\\Code.exe", args: ["C:\\repo"], options: { stdio: "ignore", windowsHide: true } },
    ])
    expect(calls).toEqual([])
  })

  test("uses hidden execFile through macOS open for macOS explicit app opens", async () => {
    const restore = platform("darwin")

    try {
      await openPathWithApp("/repo", "Visual Studio Code")
    } finally {
      restore()
    }

    expect(calls).toEqual([
      { command: "open", args: ["-a", "Visual Studio Code", "/repo"], options: { windowsHide: true } },
    ])
    expect(spawnCalls).toEqual([])
  })

  test("uses hidden execFile directly for Linux explicit app opens", async () => {
    const restore = platform("linux")

    try {
      await openPathWithApp("/repo", "code")
    } finally {
      restore()
    }

    expect(calls).toEqual([{ command: "code", args: ["/repo"], options: { windowsHide: true } }])
    expect(spawnCalls).toEqual([])
  })

  test("uses hidden process creation for Windows app path resolution", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const file = path.join(dir, "Code.exe")
    const restore = platform("win32")
    output = `${file}\r\n`

    try {
      await fs.writeFile(file, "")
      expect(await resolveAppPath("code")).toBe(file)
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("code")])
  })

  test("skips stale direct Windows executable paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const restore = platform("win32")
    output = `${path.join(dir, "Missing.exe")}\r\n`

    try {
      expect(await resolveAppPath("stale-code")).toBeNull()
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("stale-code")])
  })

  test("continues past stale Windows executables to launchable paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const missing = path.join(dir, "Missing.exe")
    const file = path.join(dir, "Code.exe")
    const restore = platform("win32")
    output = `${missing}\r\n${file}\r\n`

    try {
      await fs.writeFile(file, "")
      expect(await resolveAppPath("stale-then-code")).toBe(file)
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("stale-then-code")])
  })

  test("reuses resolved Windows app paths for repeated opens", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const file = path.join(dir, "Code.exe")
    output = `${file}\r\n`
    const restore = platform("win32")

    try {
      await fs.writeFile(file, "")

      expect(await resolveAppPath("cached-code")).toBe(file)
      expect(await resolveAppPath("cached-code")).toBe(file)
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("cached-code")])
  })

  test("re-resolves cached Windows app paths that no longer exist", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const first = path.join(dir, "First.exe")
    const second = path.join(dir, "Second.exe")
    const restore = platform("win32")

    try {
      await fs.writeFile(first, "")
      output = `${first}\r\n`
      expect(await resolveAppPath("moving-code")).toBe(first)

      await fs.rm(first)
      await fs.writeFile(second, "")
      output = `${second}\r\n`
      expect(await resolveAppPath("moving-code")).toBe(second)
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("moving-code"), whereCall("moving-code")])
  })

  test("does not cache missing Windows app paths", async () => {
    const restore = platform("win32")

    try {
      expect(await resolveAppPath("missing-code")).toBeNull()
      expect(await resolveAppPath("missing-code")).toBeNull()
    } finally {
      restore()
    }

    expect(calls).toEqual([whereCall("missing-code"), whereCall("missing-code")])
  })

  test("ignores unreadable Windows command shims", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const restore = platform("win32")
    output = `${path.join(dir, "Missing.cmd")}\r\n`

    try {
      expect(await resolveAppPath("broken-shim")).toBeNull()
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("broken-shim")])
  })

  test("does not return unresolved Windows command shims as launchable app paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const file = path.join(dir, "Code.cmd")
    const restore = platform("win32")
    output = `${file}\r\n`

    try {
      await fs.writeFile(file, "@echo off\r\nexit /b 0\r\n")
      expect(await resolveAppPath("unresolved-shim")).toBeNull()
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls).toEqual([whereCall("unresolved-shim")])
  })

  test("treats malformed Windows resolver output as unresolved", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const restore = platform("win32")
    const outputs = ["\r\n", `${path.join(dir, "Missing.exe")}\r\n`, `${path.join(dir, "Script.ps1")}\r\n`]

    try {
      for (const index of Array.from({ length: outputs.length }, (_, index) => index)) {
        output = outputs[index]
        expect(await resolveAppPath(`malformed-code-${index}`)).toBeNull()
      }
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls.map((call) => call.args[0])).toEqual(["malformed-code-0", "malformed-code-1", "malformed-code-2"])
  })

  test("bounds cached Windows app paths across many unique apps", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-test-"))
    const restore = platform("win32")

    try {
      for (const index of Array.from({ length: APP_PATH_CACHE_LIMIT + 1 }, (_, index) => index)) {
        const file = path.join(dir, `Code-${index}.exe`)
        await fs.writeFile(file, "")
        output = `${file}\r\n`

        expect(await resolveAppPath(`bounded-code-${index}`)).toBe(file)
      }

      output = `${path.join(dir, "Code-0.exe")}\r\n`
      expect(await resolveAppPath("bounded-code-0")).toBe(path.join(dir, "Code-0.exe"))
    } finally {
      restore()
      await fs.rm(dir, { recursive: true, force: true })
    }

    expect(calls.filter((call) => call.args[0] === "bounded-code-0")).toHaveLength(2)
  })
})
