import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"

const probe = path.join(import.meta.dir, "fixture/hidden-console-probe.ts")
const build = Number.parseInt(os.release().split(".")[2] ?? "", 10)
const supportsHiddenConsole = process.platform === "win32" && build >= 26100

describe("HiddenConsole", () => {
  // AllocConsoleWithOptions requires Windows 11 24H2 / Server 2025 (build 26100+).
  test.skipIf(!supportsHiddenConsole)(
    "gives a detached Windows service a windowless console inherited by unhidden children while keeping stdio pipes",
    async () => {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--no-config", probe], {
          detached: true,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
        const out: Buffer[] = []
        const err: Buffer[] = []
        child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
        child.stderr?.on("data", (chunk: Buffer) => err.push(chunk))
        child.once("error", reject)
        child.once("close", (code) =>
          resolve({
            code,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
          }),
        )
      })

      expect(result.stderr.trim()).toBe("stderr-pipe-intact")
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout.trim())).toEqual({
        beforeCount: 0,
        status: undefined,
        repeatStatus: undefined,
        afterCount: 1,
        hwnd: 0,
        child: {
          count: 2,
          hwnd: 0,
        },
      })
    },
  )
})
