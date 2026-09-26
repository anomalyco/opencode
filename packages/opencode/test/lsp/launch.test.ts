import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { buffer } from "node:stream/consumers"
import { spawn } from "../../src/lsp/launch"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

describe("lsp.launch", () => {
  test("forwards standard input and output to an owned child", async () => {
    const proc = spawn(process.execPath, [
      "-e",
      'const timeout = setTimeout(() => process.exit(2), 1000); process.stdin.once("data", (data) => { clearTimeout(timeout); process.stdout.write(data, () => process.exit(0)) })',
    ])

    const output = await new Promise<string>((resolve, reject) => {
      proc.stdout.once("data", (data) => resolve(data.toString()))
      proc.once("error", reject)
      proc.stdin.write("lsp input")
    })

    expect(output).toBe("lsp input")
    expect(await proc.exited).toBe(0)
  })

  test("stops an owned child process tree", async () => {
    const proc = spawn(process.execPath, [
      "-e",
      `
        const { spawn } = require("node:child_process")
        const child = spawn(process.execPath, ["-e", 'const http = require("node:http"); http.createServer((_, response) => response.end("alive")).listen(0, "127.0.0.1", function () { process.stdout.write(process.pid + ":" + this.address().port + "\\\\n") })'], { stdio: ["ignore", "pipe", "ignore"] })
        child.stdout.pipe(process.stdout)
        setInterval(() => {}, 1000)
      `,
    ])
    let child: { pid: number; port: number } | undefined

    try {
      child = await new Promise<{ pid: number; port: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("child process did not publish its address")), 1000)
        proc.stdout.once("data", (data) => {
          clearTimeout(timer)
          const [pid, port] = data.toString().trim().split(":").map(Number)
          if (pid === undefined || port === undefined) {
            return reject(new Error("child process published an invalid address"))
          }
          resolve({ pid, port })
        })
        proc.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      await Process.stop(proc)
      await proc.exited

      await expectServerStopped(child.port)
      await expectProcessStopped(child.pid)
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
      if (child) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch {}
      }
    }
  }, 3000)

  test("stops an owned child process tree after its leader exits", async () => {
    const proc = spawn(process.execPath, [
      "-e",
      `
        const { spawn } = require("node:child_process")
        const child = spawn(process.execPath, ["-e", 'const http = require("node:http"); http.createServer((_, response) => response.end("alive")).listen(0, "127.0.0.1", function () { process.stdout.write(process.pid + ":" + this.address().port + "\\\\n") })'], { stdio: ["ignore", "pipe", "ignore"] })
        child.stdout.pipe(process.stdout)
        setInterval(() => {}, 1000)
      `,
    ])
    let child: { pid: number; port: number } | undefined

    try {
      child = await new Promise<{ pid: number; port: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("child process did not publish its address")), 1000)
        proc.stdout.once("data", (data) => {
          clearTimeout(timer)
          const [pid, port] = data.toString().trim().split(":").map(Number)
          if (pid === undefined || port === undefined) {
            return reject(new Error("child process published an invalid address"))
          }
          resolve({ pid, port })
        })
        proc.once("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      proc.kill("SIGKILL")
      await proc.exited

      await expectServerStopped(child.port)
      await expectProcessStopped(child.pid)
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
      if (child) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch {}
      }
    }
  }, 3000)

  test("preserves literal cmd arguments with spaces on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nsetlocal DisableDelayedExpansion\r\necho(%~1\r\n")

    const argument = 'space "quote" \\ % ! ^ & | < > ( )'
    const proc = spawn(file, [argument])
    const output = await new Promise<string>((resolve, reject) => {
      proc.stdout.once("data", (data) => resolve(data.toString()))
      proc.once("error", reject)
    })

    expect(await proc.exited).toBe(0)
    expect(output.trimEnd()).toBe(argument)
  })

  test("round-trips native executable arguments on Windows", async () => {
    if (process.platform !== "win32") return

    const args = ["", "space value", 'slashes\\\\"quote', "trailing\\\\"]
    const proc = spawn(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args])

    const output = await buffer(proc.stdout)
    expect(await proc.exited).toBe(0)
    expect(JSON.parse(output.toString())).toEqual(args)
  })

  test("preserves literal cmd shim arguments on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "node_modules", ".bin")
    const file = path.join(dir, "forward.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(
      file,
      `@echo off\r\n"${process.execPath}" -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n`,
    )

    const args = ['quote"slashes\\\\"', "operators & | < > ^ % ! ( )"]
    const proc = spawn(file, args)

    const output = await buffer(proc.stdout)
    expect(await proc.exited).toBe(0)
    expect(JSON.parse(output.toString())).toEqual(args)
  })

  test("forwards owned stderr on Windows", async () => {
    if (process.platform !== "win32") return

    const proc = spawn(process.execPath, ["-e", 'process.stderr.write("helper stderr")'])

    const output = await buffer(proc.stderr)
    expect(await proc.exited).toBe(0)
    expect(output.toString()).toBe("helper stderr")
  })

  test("reports missing owned commands on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const proc = spawn(path.join(tmp.path, "missing.exe"))

    const output = await buffer(proc.stderr)
    expect(await proc.exited).toBe(1)
    expect(output.toString()).toContain("SearchPathW failed")
  })

  test("does not resolve bare commands from cwd on Windows", async () => {
    if (process.platform !== "win32") return

    const command = path.basename(process.execPath)
    if (!Bun.which(command)) return

    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, command), "not an executable")
    const proc = spawn(command, ["-e", 'process.stdout.write("resolved from PATH")'], { cwd: tmp.path })

    const output = await buffer(proc.stdout)
    expect(await proc.exited).toBe(0)
    expect(output.toString()).toBe("resolved from PATH")
  })
})

async function expectServerStopped(port: number) {
  const started = Date.now()
  while (true) {
    const running = await fetch(`http://127.0.0.1:${port}`).then(
      (response) => response.ok,
      () => false,
    )
    if (!running) return
    if (Date.now() - started > 1000) throw new Error("owned child process remained reachable")
    await Bun.sleep(10)
  }
}

async function expectProcessStopped(pid: number) {
  const started = Date.now()
  while (true) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    if (Date.now() - started > 1000) throw new Error("owned child process did not terminate")
    await Bun.sleep(10)
  }
}
