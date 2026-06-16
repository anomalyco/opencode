import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import { ShellBackground } from "@opencode-ai/core/shell-background"
import { testEffect } from "./lib/effect"

const it = testEffect(AppProcess.defaultLayer)
const shell = process.platform === "win32" ? process.env.COMSPEC ?? "cmd.exe" : "/bin/sh"
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("ShellBackground", () => {
  test("auto mode recognizes obvious long-running commands", () => {
    expect(ShellBackground.shouldAutoBackground("pnpm dev")).toBe(true)
    expect(ShellBackground.shouldAutoBackground("docker compose up")).toBe(true)
    expect(ShellBackground.shouldAutoBackground("docker compose up -d")).toBe(false)
    expect(ShellBackground.shouldAutoBackground("tail -f server.log")).toBe(true)
    expect(ShellBackground.shouldAutoBackground("echo hello")).toBe(false)
  })

  test("requested and config auto modes resolve predictably", () => {
    expect(ShellBackground.resolve({ command: "pnpm dev", requested: true })).toEqual({
      background: true,
      mode: "manual",
    })
    expect(ShellBackground.resolve({ command: "pnpm dev", requested: false, configAuto: true })).toEqual({
      background: false,
      mode: "foreground",
    })
    expect(ShellBackground.resolve({ command: "pnpm dev", requested: "auto" })).toEqual({
      background: true,
      mode: "auto",
    })
    expect(ShellBackground.resolve({ command: "pnpm dev", configAuto: true })).toEqual({
      background: true,
      mode: "config-auto",
    })
    expect(ShellBackground.resolve({ command: "echo hi", requested: "auto" })).toEqual({
      background: false,
      mode: "foreground",
    })
  })

  it.live(
    "managed supervisor kills the shell child when the parent pid is gone",
    Effect.acquireUseRelease(
      Effect.promise(() => fs.mkdtemp(path.join(tmpdir(), "opencode-shell-bg-"))),
      (directory) => {
        const ready = path.join(directory, "ready")
        const settled = path.join(directory, "settled")
        const script = [
          "const fs = require('fs')",
          `fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid))`,
          `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(settled)}, 'settled'); process.exit(0) })`,
          "setInterval(() => {}, 60_000)",
        ].join(";")
        const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`
        return Effect.gen(function* () {
          const svc = yield* AppProcess.Service
          const result = yield* svc.runObserved(
            ShellBackground.managedProcess({
              shell,
              command,
              cwd: directory,
              env: process.env,
              parentPID: 999999,
            }),
            { timeout: "5 seconds" },
          )
          expect(result.timedOut).toBeUndefined()
          const pid = Number(
            yield* Effect.promise(async () => {
              const end = Date.now() + 5000
              while (Date.now() < end) {
                try {
                  return await fs.readFile(ready, "utf8")
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
                }
                await new Promise((resolve) => setTimeout(resolve, 25))
              }
              throw new Error("expected child to write ready pid")
            }),
          )
          const dead = yield* Effect.promise(async () => {
            const end = Date.now() + 5000
            while (Date.now() < end) {
              if (!alive(pid)) return true
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            return !alive(pid)
          })
          expect(dead).toBe(true)
          if (process.platform !== "win32") {
            const settledText = yield* Effect.promise(() => fs.readFile(settled, "utf8"))
            expect(settledText).toBe("settled")
          }
        })
      },
      (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
    ),
    10_000,
  )
})
