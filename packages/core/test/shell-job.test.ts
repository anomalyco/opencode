import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { ShellBackground } from "@opencode-ai/core/shell-background"
import { ShellJob } from "@opencode-ai/core/shell-job"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"

const layer = ShellJob.defaultLayer.pipe(Layer.provide(AppProcess.defaultLayer), Layer.provide(BackgroundJob.defaultLayer))
const it = testEffect(layer)

const sessionID = SessionV2.ID.make("ses_shell_job_test")

const waitForFile = async (file: string) => {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    try {
      return await fs.readFile(file, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${file}`)
}

const pidAbsent = async (pid: string) => {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (process.platform === "win32") {
      const out = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`], { stdout: "pipe", stderr: "pipe" })
        .stdout.toString()
        .toLowerCase()
      if (out.includes("nenhuma tarefa") || out.includes("no tasks are running")) return true
    } else {
      try {
        process.kill(Number(pid), 0)
      } catch {
        return true
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

describe("ShellJob", () => {
  it.live(
    "cancel kills the managed background shell child process",
    Effect.acquireUseRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-shell-job-test-"))),
      (directory) => {
        const ready = path.join(directory, "ready")
        const shell = process.platform === "win32" ? process.env.COMSPEC ?? "cmd.exe" : "/bin/sh"
        const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
          [
            "const fs = require('fs')",
            `fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid))`,
            "console.log('ready')",
            "setInterval(() => console.log('tick'), 1000)",
          ].join(";"),
        )}`
        return Effect.gen(function* () {
          const jobs = yield* ShellJob.Service
          const started = yield* jobs.start({
            sessionID,
            command,
            cwd: process.cwd(),
            process: ShellBackground.managedProcess({ shell, command, cwd: process.cwd(), env: process.env }),
            timeout: 30_000,
          })
          expect(started.status).toBe("running")

          const pid = (yield* Effect.promise(() => waitForFile(ready))).trim()
          const cancelled = yield* jobs.cancel({ sessionID, jobId: started.jobId })
          expect(cancelled?.status).toBe("cancelled")
          expect(yield* Effect.promise(() => pidAbsent(pid))).toBe(true)
        })
      },
      (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
    ),
    15_000,
  )
})
