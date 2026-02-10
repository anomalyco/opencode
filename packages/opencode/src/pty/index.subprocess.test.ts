import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("pty real subprocess (isolated process)", () => {
  test("runs lifecycle case with real bun-pty in a clean test process", async () => {
    const cwd = path.resolve(import.meta.dir, "..", "..")
    const proc = Bun.spawn(["bun", "test", "./src/pty/index.subprocess.case.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPENCODE_PTY_SUBPROCESS_CASE: "1",
      },
    })
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const code = await proc.exited
    expect(code, `subprocess case failed\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
  })
})
