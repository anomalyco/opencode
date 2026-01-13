import { afterEach, describe, expect, test } from "bun:test"
import { createTunnelConnection, TunnelProcess, TunnelSpawner } from "../tunnel-connection"

const cleanup: Array<() => void> = []

afterEach(() => {
  const tasks = cleanup.splice(0)
  for (const task of tasks) {
    task()
  }
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

function extractLocalPort(args: string[]): number | null {
  const index = args.indexOf("-L")
  if (index < 0) {
    return null
  }
  const value = args[index + 1]
  if (!value) {
    return null
  }
  const match = value.match(/^127\.0\.0\.1:(\d+):127\.0\.0\.1:/)
  if (!match) {
    return null
  }
  return Number(match[1])
}

describe("Phase B Gate: Transport + Discovery", () => {
  test("tunnel flow reports compatible discovery", async () => {
    const spawn: TunnelSpawner = async (command) => {
      const port = extractLocalPort(command.args)
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
            return Response.json({ healthy: true, version: "1.0.1" })
          }
          return new Response("Not Found", { status: 404 })
        },
      })

      cleanup.push(() => server.stop())

      return {
        success: true,
        process: buildProcess(7070),
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
})
