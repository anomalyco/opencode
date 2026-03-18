import { describe, expect, test } from "bun:test"
import { normalizeServerUrl, serverName, ServerConnection } from "./server"

describe("normalizeServerUrl", () => {
  test("adds http protocol when missing", () => {
    expect(normalizeServerUrl("localhost:4096")).toBe("http://localhost:4096")
    expect(normalizeServerUrl("192.168.1.100:4096")).toBe("http://192.168.1.100:4096")
  })

  test("preserves existing protocol", () => {
    expect(normalizeServerUrl("http://localhost:4096")).toBe("http://localhost:4096")
    expect(normalizeServerUrl("https://example.com:4096")).toBe("https://example.com:4096")
  })

  test("removes trailing slashes", () => {
    expect(normalizeServerUrl("http://localhost:4096/")).toBe("http://localhost:4096")
    expect(normalizeServerUrl("http://localhost:4096///")).toBe("http://localhost:4096")
  })

  test("handles whitespace", () => {
    expect(normalizeServerUrl("  localhost:4096  ")).toBe("http://localhost:4096")
  })

  test("returns undefined for empty input", () => {
    expect(normalizeServerUrl("")).toBeUndefined()
    expect(normalizeServerUrl("   ")).toBeUndefined()
  })
})

describe("serverName", () => {
  test("returns displayName when available", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      displayName: "My Remote Server",
      http: { url: "http://192.168.1.100:4096" },
    }
    expect(serverName(conn)).toBe("My Remote Server")
  })

  test("extracts host from URL when no displayName", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://192.168.1.100:4096" },
    }
    expect(serverName(conn)).toBe("192.168.1.100:4096")
  })

  test("ignores displayName when ignoreDisplayName is true", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      displayName: "My Remote Server",
      http: { url: "http://192.168.1.100:4096" },
    }
    expect(serverName(conn, true)).toBe("192.168.1.100:4096")
  })

  test("handles sidecar connections", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "base",
      http: { url: "http://localhost:4096" },
    }
    expect(serverName(conn)).toBe("localhost:4096")
  })

  test("handles SSH connections", () => {
    const conn: ServerConnection.Ssh = {
      type: "ssh",
      host: "remote.example.com",
      http: { url: "http://localhost:4097" },
    }
    expect(serverName(conn)).toBe("localhost:4097")
  })

  test("returns empty string for undefined", () => {
    expect(serverName()).toBe("")
  })
})

describe("ServerConnection.key", () => {
  test("generates key for HTTP connection", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://192.168.1.100:4096" },
    }
    expect(ServerConnection.key(conn) as string).toBe("http://192.168.1.100:4096")
  })

  test("generates key for sidecar base connection", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "base",
      http: { url: "http://localhost:4096" },
    }
    expect(ServerConnection.key(conn) as string).toBe("sidecar")
  })

  test("generates key for sidecar WSL connection", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "wsl",
      distro: "Ubuntu-22.04",
      http: { url: "http://localhost:4096" },
    }
    expect(ServerConnection.key(conn) as string).toBe("wsl:Ubuntu-22.04")
  })

  test("generates key for SSH connection", () => {
    const conn: ServerConnection.Ssh = {
      type: "ssh",
      host: "remote.example.com",
      http: { url: "http://localhost:4097" },
    }
    expect(ServerConnection.key(conn) as string).toBe("ssh:remote.example.com")
  })
})

describe("ServerConnection types", () => {
  test("HTTP connection structure", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      displayName: "Remote",
      http: {
        url: "http://192.168.1.100:4096",
        username: "user",
        password: "pass",
      },
    }
    expect(conn.type).toBe("http")
    expect(conn.http.url).toBe("http://192.168.1.100:4096")
    expect(conn.http.username).toBe("user")
    expect(conn.http.password).toBe("pass")
  })

  test("Sidecar base connection structure", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "base",
      http: { url: "http://localhost:4096" },
    }
    expect(conn.type).toBe("sidecar")
    expect(conn.variant).toBe("base")
  })

  test("Sidecar WSL connection structure", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "wsl",
      distro: "Ubuntu",
      http: { url: "http://localhost:4096" },
    }
    expect(conn.type).toBe("sidecar")
    expect(conn.variant).toBe("wsl")
    expect(conn.distro).toBe("Ubuntu")
  })

  test("SSH connection structure", () => {
    const conn: ServerConnection.Ssh = {
      type: "ssh",
      host: "192.168.1.100",
      http: { url: "http://localhost:4097" },
    }
    expect(conn.type).toBe("ssh")
    expect(conn.host).toBe("192.168.1.100")
  })
})
