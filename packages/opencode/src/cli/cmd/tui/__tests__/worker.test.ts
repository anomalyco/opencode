import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test"

describe("Worker TUI corruption", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("should NOT call console.error on server start failure (corrupts TUI)", async () => {
    // Import the worker's rpc module
    // We need to trigger a server start failure

    // The worker.ts code does:
    // } catch (e) {
    //   console.error(e)  <-- THIS IS THE BUG
    //   throw e
    // }

    // To prove this, we just need to show the pattern exists
    // Reading the source directly:
    const workerSource = await Bun.file(new URL("../worker.ts", import.meta.url).pathname).text()

    // Check if console.error exists in the catch block
    const hasConsoleError = workerSource.includes("console.error(e)")

    expect(hasConsoleError).toBe(false) // FAILS - proving the bug exists
  })
})
