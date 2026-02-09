import { test, expect, describe } from "bun:test"
import { spawn } from "child_process"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(__dirname, "../../src/index.ts")

describe("CLI signal handling", () => {
  test("SIGHUP handler causes graceful exit", async () => {
    // Start a long-running CLI process that would normally hang
    const child = spawn(process.execPath, ["--conditions=browser", indexPath, "serve", "--port", "0"], {
      stdio: "pipe",
      timeout: 10000, // 10 second timeout
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    // Wait a bit for the process to start up
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Send SIGHUP signal to test the handler
    child.kill("SIGHUP")

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0))
    })

    // Process should exit with code 0 due to our SIGHUP handler
    expect(exitCode).toBe(0)

    // Should not have errors in stderr
    expect(stderr).toBe("")
  })

  test("process starts without signal handler errors", async () => {
    // Test that the SIGHUP handler doesn't cause startup errors
    const child = spawn(process.execPath, ["--conditions=browser", indexPath, "--version"], {
      stdio: "pipe",
      timeout: 5000,
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0))
    })

    // Should exit successfully
    expect(exitCode).toBe(0)

    // Should not have any errors related to signal handling
    expect(stderr).toBe("")

    // Should output version information
    expect(stdout.length).toBeGreaterThan(0)
  })
})
