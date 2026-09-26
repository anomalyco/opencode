import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Process } from "@/util/process"
import { tmpdir } from "../fixture/fixture"

function node(script: string) {
  return [process.execPath, "-e", script]
}

describe("util.process", () => {
  test("captures stdout and stderr", async () => {
    const out = await Process.run(node('process.stdout.write("out");process.stderr.write("err")'))
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  })

  test("returns code when nothrow is enabled", async () => {
    const out = await Process.run(node("process.exit(7)"), { nothrow: true })
    expect(out.code).toBe(7)
  })

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await Process.run(node('process.stderr.write("bad");process.exit(3)')).catch((error) => error)
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  })

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node("setInterval(() => {}, 1000)"), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("kills after timeout when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      abort: abort.signal,
      nothrow: true,
      timeout: 25,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("stops only the direct process by default", async () => {
    if (process.platform === "win32") return

    const proc = Process.spawn(
      node(`
        const { spawn } = require("node:child_process")
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
        process.stdout.write(String(child.pid) + "\\n")
        setInterval(() => {}, 1000)
      `),
      { stdout: "pipe" },
    )
    let childPID: number | undefined

    try {
      childPID = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("child process did not publish its pid")), 1000)
        proc.stdout?.once("data", (data) => {
          clearTimeout(timer)
          resolve(Number(data.toString()))
        })
        proc.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      await Process.stop(proc)
      await proc.exited
      const pid = childPID
      if (pid === undefined) throw new Error("child process did not publish its pid")
      expect(() => process.kill(pid, 0)).not.toThrow()
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
      if (childPID) {
        try {
          process.kill(childPID, "SIGKILL")
        } catch {}
      }
    }
  }, 3000)

  test("uses cwd when spawning commands", async () => {
    await using tmp = await tmpdir()
    const out = await Process.run(node("process.stdout.write(process.cwd())"), {
      cwd: tmp.path,
    })
    expect(out.stdout.toString()).toBe(tmp.path)
  })

  test("merges environment overrides", async () => {
    const out = await Process.run(node('process.stdout.write(process.env.OPENCODE_TEST ?? "")'), {
      env: {
        OPENCODE_TEST: "set",
      },
    })
    expect(out.stdout.toString()).toBe("set")
  })

  test("preserves cwd, environment, and stdout for owned processes", async () => {
    await using tmp = await tmpdir()
    const out = await Process.run(node('process.stdout.write(process.cwd() + ":" + process.env.OPENCODE_TEST)'), {
      cwd: tmp.path,
      env: { OPENCODE_TEST: "set" },
      owned: true,
    })

    expect(out.stdout.toString()).toBe(`${tmp.path}:set`)
  })

  test("rejects shell for owned processes", () => {
    expect(() => Process.spawn(node("process.exit(0)"), { owned: true, shell: true })).toThrow(
      "Owned processes do not support shell",
    )
  })

  test("uses shell in run on Windows", async () => {
    if (process.platform !== "win32") return

    const out = await Process.run(["set", "OPENCODE_TEST_SHELL"], {
      shell: true,
      env: {
        OPENCODE_TEST_SHELL: "ok",
      },
    })

    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toContain("OPENCODE_TEST_SHELL=ok")
  })

  test("runs cmd scripts with spaces on Windows without shell", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = Process.spawn([file, "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await proc.exited).toBe(0)
  })

  test("rejects missing commands without leaking unhandled errors", async () => {
    await using tmp = await tmpdir()
    const cmd = path.join(tmp.path, "missing" + (process.platform === "win32" ? ".cmd" : ""))
    const err = await Process.spawn([cmd], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }).exited.catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err).toMatchObject({
      code: "ENOENT",
    })
  })

  test("rejects owned missing commands without leaking unhandled errors", async () => {
    await using tmp = await tmpdir()
    const cmd = path.join(tmp.path, "missing" + (process.platform === "win32" ? ".cmd" : ""))
    const err = await (() => {
      try {
        return Process.spawn([cmd], {
          owned: true,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        }).exited
      } catch (error) {
        return Promise.reject(error)
      }
    })().catch((error) => error)

    if (process.platform === "win32") expect(err).toBe(1)
    else expect(err).toMatchObject({ message: "Unable to own process without a PID" })
    await Bun.sleep(10)
  })
})
