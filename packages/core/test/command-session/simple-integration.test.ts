import { describe, expect, test } from "bun:test"
import { spawn, ChildProcess } from "node:child_process"

describe("CommandSession - Simple Integration Tests", () => {
  test("should start a simple command and capture output", async () => {
    const proc = spawn("echo", ["hello", "world"], {
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    await new Promise<void>((resolve) => {
      proc.on("close", (code) => {
        expect(code).toBe(0)
        expect(stdout.trim()).toBe("hello world")
        resolve()
      })
    })
  })

  test("should handle interactive commands with input", async () => {
    const scriptPath = "/tmp/test-interactive.sh"
    const fs = require("fs")
    
    fs.writeFileSync(
      scriptPath,
      `#!/bin/bash
echo "Enter your name:"
read name
echo "Hello, \$name!"
`,
    )
    fs.chmodSync(scriptPath, 0o755)

    const proc = spawn("bash", [scriptPath], {
      cwd: "/tmp",
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    // Wait for prompt
    await new Promise<void>((resolve) => {
      const check = () => {
        if (stdout.includes("Enter your name:")) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      setTimeout(check, 1000)
    })

    // Send input
    proc.stdin.write("Alice\n")

    // Wait for response
    await new Promise<void>((resolve) => {
      proc.on("close", (code) => {
        expect(stdout).toContain("Hello, Alice!")
        resolve()
      })
    })

    // Cleanup
    fs.unlinkSync(scriptPath)
  })

  test("should handle command errors", async () => {
    const proc = spawn("bash", ["-c", "echo 'Error' >&2; exit 1"], {
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    await new Promise<void>((resolve) => {
      proc.on("close", (code) => {
        expect(code).toBe(1)
        expect(stderr).toContain("Error")
        resolve()
      })
    })
  })

  test("should handle multiple concurrent processes", async () => {
    const procs = [
      spawn("sleep", ["1"], { cwd: "/tmp", stdio: "ignore" }),
      spawn("sleep", ["1"], { cwd: "/tmp", stdio: "ignore" }),
      spawn("sleep", ["1"], { cwd: "/tmp", stdio: "ignore" }),
    ]

    const results = await Promise.all(
      procs.map((proc) => new Promise<number>((resolve) => {
        proc.on("close", (code) => resolve(code ?? -1))
      })),
    )

    expect(results).toEqual([0, 0, 0])
  })

  test("should kill a running process", async () => {
    const proc = spawn("sleep", ["100"], {
      cwd: "/tmp",
      stdio: "ignore",
    })

    // Give it time to start
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Check if it's running
    try {
      process.kill(proc.pid!, 0)
      // Process is running
    } catch {
      throw new Error("Process should still be running")
    }

    // Kill it
    proc.kill("SIGTERM")

    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve())
    })

    // Verify it's dead
    expect(proc.killed).toBe(true)
  })
})
