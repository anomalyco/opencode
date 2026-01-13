import { afterEach, describe, expect, test } from "bun:test"
import { createTunnelConnection } from "../tunnel-connection"
import { SshInvocationBuilder } from "../invocation-builder"
import { SshInvocationParams } from "../types"

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  const tasks = cleanup.splice(0)
  await Promise.all(tasks.map((task) => task()))
})

async function canUseLocalSsh(): Promise<boolean> {
  const path = Bun.which("ssh")
  if (!path) {
    return false
  }

  const probe = Bun.spawn(
    [
      path,
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=3",
      "localhost",
      "true",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const code = await probe.exited
  return code === 0
}

const sshReady = await canUseLocalSsh()
const acceptance = sshReady ? test : test.skip

const localUser = process.env.USER ?? process.env.USERNAME

describe("Phase A Gate: SSH Tunnel Acceptance", () => {
  acceptance("tunnel forwards HTTP over localhost SSH", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("ok")
      },
    })

    cleanup.push(() => server.stop())

    if (!server.port) {
      throw new Error("Server port not assigned")
    }

    const result = await createTunnelConnection({
      sshParams: {
        host: "localhost",
        user: localUser,
        remotePort: server.port,
        sshConfigMode: "pass-through",
      },
      connectTimeoutMs: 5000,
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.handle.localPort).toBeGreaterThan(0)
    expect(result.process.pid).toBeGreaterThan(0)

    cleanup.push(async () => {
      result.process.kill()
      await result.process.exited
    })

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.process.exitCode).toBeNull()

    const response = await fetch(result.baseUrl)
    const body = await response.text()
    expect(response.ok).toBe(true)
    expect(body).toEqual("ok")
  })

  test("command arguments remain array-safe", () => {
    const builder = new SshInvocationBuilder()
    const params: SshInvocationParams = {
      host: "localhost; rm -rf /",
      user: "user$(whoami)",
      localPort: 8080,
      remotePort: 3000,
    }

    const command = builder.buildTunnel(params)
    const hostArgs = command.args.filter((arg) => arg.includes("localhost; rm -rf /"))

    expect(hostArgs.length).toEqual(1)
    expect(hostArgs[0]).toContain("user$(whoami)@localhost; rm -rf /")
  })
})
