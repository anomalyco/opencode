import { describe, expect, test } from "bun:test"
import { spawn } from "child_process"

describe("ACP Server", () => {
  test("initialize and shutdown", async () => {
    const proc = spawn("bun", ["run", "dev", "acp"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OPENCODE: "1" },
    })

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    let initResponse: any = null

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = decoder.decode(chunk).split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const msg = JSON.parse(trimmed)
          if (msg.id === 1) initResponse = msg
        } catch (e) {}
      }
    })

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 500))

    proc.stdin.write(
      encoder.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        }) + "\n",
      ),
    )

    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(initResponse).toBeTruthy()
    expect(initResponse.result.protocolVersion).toBe(1)
    expect(initResponse.result.agentCapabilities).toBeTruthy()

    proc.kill()
  }, 10000)

  test("create session", async () => {
    const proc = spawn("bun", ["run", "dev", "acp"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OPENCODE: "1" },
    })

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    let sessionResponse: any = null

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = decoder.decode(chunk).split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const msg = JSON.parse(trimmed)
          if (msg.id === 2) sessionResponse = msg
        } catch (e) {}
      }
    })

    proc.stdin.write(
      encoder.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        }) + "\n",
      ),
    )

    await new Promise((resolve) => setTimeout(resolve, 500))

    proc.stdin.write(
      encoder.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: {
            cwd: process.cwd(),
            mcpServers: [],
          },
        }) + "\n",
      ),
    )

    await new Promise((resolve) => setTimeout(resolve, 1000))

    expect(sessionResponse).toBeTruthy()
    expect(sessionResponse.result.sessionId).toBeTruthy()

    proc.kill()
  }, 10000)
})
