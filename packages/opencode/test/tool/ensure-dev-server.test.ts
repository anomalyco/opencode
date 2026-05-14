import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:net"
import { probePort, serveUrl } from "../../src/tool/ensure-dev-server"

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        server.close()
        reject(new Error("expected TCP address"))
        return
      }
      resolve({ server, port: addr.port })
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe("ensure-dev-server", () => {
  describe("probePort", () => {
    test("returns false for an unbound port", async () => {
      // 일단 listen 으로 OS 가 할당한 포트를 잡았다가 즉시 닫아 "확실히 비어있는" 포트 번호를 얻는다.
      const { server, port } = await listen()
      await close(server)
      expect(await probePort(port, "127.0.0.1", 100)).toBe(false)
    })

    test("returns true when something is listening", async () => {
      const { server, port } = await listen()
      try {
        expect(await probePort(port, "127.0.0.1", 250)).toBe(true)
      } finally {
        await close(server)
      }
    })
  })

  describe("serveUrl", () => {
    const ORIGINAL_USER = process.env["JUPYTERHUB_USER"]
    const ORIGINAL_DOMAIN = process.env["OPENCODE_SERVE_DOMAIN"]

    afterEach(() => {
      if (ORIGINAL_USER === undefined) delete process.env["JUPYTERHUB_USER"]
      else process.env["JUPYTERHUB_USER"] = ORIGINAL_USER
      if (ORIGINAL_DOMAIN === undefined) delete process.env["OPENCODE_SERVE_DOMAIN"]
      else process.env["OPENCODE_SERVE_DOMAIN"] = ORIGINAL_DOMAIN
    })

    test("falls back to localhost when JupyterHub env vars are missing", () => {
      delete process.env["JUPYTERHUB_USER"]
      delete process.env["OPENCODE_SERVE_DOMAIN"]
      expect(serveUrl(3000)).toBe("http://localhost:3000/")
    })

    test("synthesizes https url from JUPYTERHUB_USER + OPENCODE_SERVE_DOMAIN", () => {
      process.env["JUPYTERHUB_USER"] = "student-42"
      process.env["OPENCODE_SERVE_DOMAIN"] = "preview.example.com"
      // 포트는 외부 URL 합성에 포함되지 않는다. 외부 프록시가 sub-domain 으로 라우팅.
      expect(serveUrl(3000)).toBe("https://student-42.preview.example.com/")
    })

    test("falls back when only one of the two env vars is set", () => {
      process.env["JUPYTERHUB_USER"] = "student-42"
      delete process.env["OPENCODE_SERVE_DOMAIN"]
      expect(serveUrl(3000)).toBe("http://localhost:3000/")
    })
  })
})
