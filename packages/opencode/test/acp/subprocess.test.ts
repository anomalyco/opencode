import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { ACPSubprocess } from "@/acp/subprocess"
import { join } from "path"

describe("ACPSubprocess", () => {
  let manager: ACPSubprocess.Manager | undefined

  afterEach(async () => {
    if (manager?.isRunning()) {
      await manager.kill()
    }
    manager = undefined
  })

  it("should spawn a subprocess and communicate via ndjson", async () => {
    const messages: unknown[] = []
    const stderrChunks: string[] = []

    // Create a simple echo script that reads ndjson and writes it back
    const testScript = `
      while read line; do
        echo "$line"
      done
    `

    // Use bash to create a simple echo subprocess
    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", testScript],
      onMessage: (msg) => messages.push(msg),
      onStderr: (data) => stderrChunks.push(data),
    })

    expect(manager.isRunning()).toBe(true)
    expect(manager.pid).toBeGreaterThan(0)

    // Send a test message
    await manager.send({ type: "test", data: "hello" })
    await Bun.sleep(100) // Give time for message to be processed

    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0]).toEqual({ type: "test", data: "hello" })
  })

  it("should handle graceful shutdown", async () => {
    let exitCalled = false
    let exitCode: number | null = null

    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", "sleep 10"],
      onExit: (code) => {
        exitCalled = true
        exitCode = code
      },
    })

    expect(manager.isRunning()).toBe(true)

    await manager.kill()
    await Bun.sleep(300) // Give time for exit handler to be called

    expect(manager.isRunning()).toBe(false)
    expect(exitCalled).toBe(true)
  })

  it("should handle subprocess errors", async () => {
    const errors: Error[] = []

    await expect(
      ACPSubprocess.spawn({
        command: "/nonexistent/command",
        onError: (err) => errors.push(err),
      }),
    ).rejects.toThrow()
  })

  it("should support AsyncDisposable", async () => {
    const manager = await ACPSubprocess.create({
      command: "bash",
      args: ["-c", "sleep 10"],
    })

    expect(manager.isRunning()).toBe(true)

    await manager[Symbol.asyncDispose]()

    expect(manager.isRunning()).toBe(false)
  })

  it("should parse ndjson correctly", async () => {
    const messages: unknown[] = []

    // Create a script that outputs multiple ndjson lines
    const testScript = `
      echo '{"type":"init","id":1}'
      echo '{"type":"ready","id":2}'
      echo '{"type":"complete","id":3}'
    `

    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", testScript],
      onMessage: (msg) => messages.push(msg),
    })

    await Bun.sleep(200) // Give time for all messages to be processed

    expect(messages.length).toBe(3)
    expect(messages[0]).toEqual({ type: "init", id: 1 })
    expect(messages[1]).toEqual({ type: "ready", id: 2 })
    expect(messages[2]).toEqual({ type: "complete", id: 3 })
  })

  it("should handle invalid JSON gracefully", async () => {
    const messages: unknown[] = []

    // Create a script that outputs invalid JSON
    const testScript = `
      echo '{"valid": true}'
      echo 'invalid json'
      echo '{"valid": false}'
    `

    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", testScript],
      onMessage: (msg) => messages.push(msg),
    })

    await Bun.sleep(200)

    // Should only receive the valid messages
    expect(messages.length).toBe(2)
    expect(messages[0]).toEqual({ valid: true })
    expect(messages[1]).toEqual({ valid: false })
  })

  it("should capture stderr separately", async () => {
    const stderrChunks: string[] = []

    const testScript = `
      echo "stdout message"
      echo "stderr message" >&2
    `

    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", testScript],
      onStderr: (data) => stderrChunks.push(data),
    })

    await Bun.sleep(200)

    const stderrOutput = stderrChunks.join("")
    expect(stderrOutput).toContain("stderr message")
  })

  it("should not allow sending messages to killed process", async () => {
    manager = await ACPSubprocess.spawn({
      command: "bash",
      args: ["-c", "sleep 10"],
    })

    await manager.kill()
    await Bun.sleep(300)

    await expect(manager.send({ type: "test" })).rejects.toThrow("Subprocess is not running")
  })
})
