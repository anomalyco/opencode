import { afterEach, describe, expect, test } from "bun:test"
import { createTunnelConnection, TunnelProcess, TunnelSpawner } from "../tunnel-connection"
import { SshCommandResult } from "../types"

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  const tasks = cleanup.splice(0)
  await Promise.all(tasks.map((task) => task()))
})

function buildProcess(pid: number): TunnelProcess {
  return {
    pid,
    exitCode: null,
    stdout: null,
    stderr: null,
    kill: () => {},
    exited: Promise.resolve(0),
  }
}

function extractLocalPort(command: SshCommandResult): number | null {
  const index = command.args.indexOf("-L")
  if (index < 0) {
    return null
  }
  const value = command.args[index + 1]
  if (!value) {
    return null
  }
  const match = value.match(/^127\.0\.0\.1:(\d+):127\.0\.0\.1:/)
  if (!match) {
    return null
  }
  return Number(match[1])
}

describe("Tunnel Connection Flow", () => {
  test("creates tunnel connection with spawn stub", async () => {
    const spawn: TunnelSpawner = async () => ({
      success: true,
      process: buildProcess(4242),
    })

    const result = await createTunnelConnection({
      sshParams: {
        host: "example.com",
        remotePort: 3000,
      },
      spawn,
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.handle.pid).toEqual(4242)
    expect(result.handle.localPort).toBeGreaterThan(0)
    expect(result.command.args).toContain("-L")
    expect(result.baseUrl).toContain("http://127.0.0.1")
  })

  test("runs discovery against tunnel base url", async () => {
    const spawn: TunnelSpawner = async (command) => {
      const port = extractLocalPort(command)
      expect(port).not.toBeNull()
      if (!port) {
        return { success: false, message: "Missing local port" }
      }

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/global/health") {
            return Response.json({ healthy: true, version: "1.1.0" })
          }
          return new Response("Not Found", { status: 404 })
        },
      })

      cleanup.push(() => server.stop())

      return {
        success: true,
        process: buildProcess(9999),
      }
    }

    const result = await createTunnelConnection({
      sshParams: {
        host: "example.com",
        remotePort: 3000,
      },
      discovery: {
        minVersion: "1.0.0",
      },
      spawn,
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.discovery?.compatible).toBe(true)
  })

  test("rejects incompatible discovery results", async () => {
    const spawn: TunnelSpawner = async (command) => {
      const port = extractLocalPort(command)
      expect(port).not.toBeNull()
      if (!port) {
        return { success: false, message: "Missing local port" }
      }

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/global/health") {
            return Response.json({ healthy: true, version: "0.1.0" })
          }
          return new Response("Not Found", { status: 404 })
        },
      })

      cleanup.push(() => server.stop())

      return {
        success: true,
        process: buildProcess(8888),
      }
    }

    const result = await createTunnelConnection({
      sshParams: {
        host: "example.com",
        remotePort: 3000,
      },
      discovery: {
        minVersion: "1.0.0",
      },
      spawn,
    })

    expect(result.success).toBe(false)
    if (result.success) {
      return
    }

    expect(result.phase).toEqual("discovery")
    expect(result.details).toContain("below minimum")
  })
})
