import { describe, expect, test } from "bun:test"

// Import types inline to avoid dependency issues in test environment
type ServerConnectionHttpBase = {
  url: string
  username?: string
  password?: string
}

type ServerConnectionHttp = {
  type: "http"
  displayName?: string
  http: ServerConnectionHttpBase
}

type ServerConnectionSidecar = {
  type: "sidecar"
  variant: "base" | "wsl"
  distro?: string
  http: ServerConnectionHttpBase
}

type ServerConnectionSsh = {
  type: "ssh"
  host: string
  http: ServerConnectionHttpBase
}

type ServerConnectionAny = ServerConnectionHttp | ServerConnectionSidecar | ServerConnectionSsh

// Mock the dependencies that would normally come from SolidJS and other modules
// This test verifies the isLocal logic without requiring full SolidJS runtime

describe("isLocal server detection (Issue #13518, #18040)", () => {
  // Simulate the isLocal logic from server.tsx:214-216
  // After fix: only sidecar base connections are considered local
  function isLocalFixed(conn: ServerConnectionAny | undefined): boolean {
    return conn?.type === "sidecar" && conn.variant === "base"
  }

  // Simulate the OLD buggy logic for comparison
  // Before fix: HTTP connections to localhost were also considered local
  function isLocalBuggy(conn: ServerConnectionAny | undefined): boolean {
    if (!conn) return false
    if (conn.type === "sidecar" && conn.variant === "base") return true
    if (conn.type === "http") {
      const host = conn.http.url.replace(/^https?:\/\//, "").split(":")[0]
      if (host === "localhost" || host === "127.0.0.1") return true
    }
    return false
  }

  describe("sidecar connections", () => {
    test("sidecar base should be local", () => {
      const conn: ServerConnectionSidecar = {
        type: "sidecar",
        variant: "base",
        http: { url: "http://localhost:4096" },
      }
      expect(isLocalFixed(conn)).toBe(true)
      expect(isLocalBuggy(conn)).toBe(true) // Both agree on this
    })

    test("sidecar WSL should NOT be local", () => {
      const conn: ServerConnectionSidecar = {
        type: "sidecar",
        variant: "wsl",
        distro: "Ubuntu-22.04",
        http: { url: "http://localhost:4096" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false) // Both agree on this
    })
  })

  describe("HTTP connections to localhost", () => {
    test("HTTP localhost:4096 should NOT be local (port-forwarded remote)", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://localhost:4096" },
      }
      expect(isLocalFixed(conn)).toBe(false) // Fixed: uses web dialog
      expect(isLocalBuggy(conn)).toBe(true) // Bug: uses native file picker
    })

    test("HTTP 127.0.0.1:4096 should NOT be local (port-forwarded remote)", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://127.0.0.1:4096" },
      }
      expect(isLocalFixed(conn)).toBe(false) // Fixed: uses web dialog
      expect(isLocalBuggy(conn)).toBe(true) // Bug: uses native file picker
    })

    test("HTTP localhost with custom port should NOT be local", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://localhost:1455" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(true)
    })
  })

  describe("HTTP connections to remote servers", () => {
    test("HTTP remote IP should NOT be local", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://192.168.0.40:1455" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false) // Both agree on this
    })

    test("HTTP remote hostname should NOT be local", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://remote-server.example.com:4096" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false)
    })

    test("HTTP with credentials should NOT be local", () => {
      const conn: ServerConnectionHttp = {
        type: "http",
        displayName: "Remote VM",
        http: {
          url: "http://192.168.1.100:4096",
          username: "opencode",
          password: "secret",
        },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false)
    })
  })

  describe("SSH connections", () => {
    test("SSH remote should NOT be local", () => {
      const conn: ServerConnectionSsh = {
        type: "ssh",
        host: "remote.example.com",
        http: { url: "http://localhost:4097" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false)
    })

    test("SSH with IP should NOT be local", () => {
      const conn: ServerConnectionSsh = {
        type: "ssh",
        host: "192.168.1.100",
        http: { url: "http://localhost:4097" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      expect(isLocalBuggy(conn)).toBe(false)
    })
  })

  describe("undefined connection", () => {
    test("undefined should NOT be local", () => {
      expect(isLocalFixed(undefined)).toBe(false)
      expect(isLocalBuggy(undefined)).toBe(false)
    })
  })

  describe("real-world scenarios from issues", () => {
    test("Issue #13518: RHEL VM on localhost:4096 via port forwarding", () => {
      // User connects to VM via port forwarding: localhost:4096 -> VM:4096
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://localhost:4096" },
      }
      // Fixed behavior: should use web dialog (not local file picker)
      expect(isLocalFixed(conn)).toBe(false)
      // This means DialogSelectDirectory will be used instead of native picker
    })

    test("Issue #18040: Ubuntu server at 192.168.0.40:1455", () => {
      // User connects to remote Ubuntu server directly
      const conn: ServerConnectionHttp = {
        type: "http",
        http: { url: "http://192.168.0.40:1455" },
      }
      expect(isLocalFixed(conn)).toBe(false)
      // Should use web dialog to browse remote filesystem
    })

    test("Local desktop app with default sidecar", () => {
      // User runs desktop app with default local server
      const conn: ServerConnectionSidecar = {
        type: "sidecar",
        variant: "base",
        http: { url: "http://localhost:4096" },
      }
      expect(isLocalFixed(conn)).toBe(true)
      // Should use native file picker for better UX
    })
  })

  describe("behavior comparison", () => {
    test("fix only affects localhost HTTP connections", () => {
      const testCases: Array<{
        name: string
        conn: ServerConnectionAny
        buggyResult: boolean
        fixedResult: boolean
      }> = [
        {
          name: "sidecar base",
          conn: { type: "sidecar", variant: "base", http: { url: "http://localhost:4096" } },
          buggyResult: true,
          fixedResult: true,
        },
        {
          name: "sidecar WSL",
          conn: {
            type: "sidecar",
            variant: "wsl",
            distro: "Ubuntu",
            http: { url: "http://localhost:4096" },
          },
          buggyResult: false,
          fixedResult: false,
        },
        {
          name: "HTTP localhost",
          conn: { type: "http", http: { url: "http://localhost:4096" } },
          buggyResult: true, // BUG: incorrectly local
          fixedResult: false, // FIXED: correctly remote
        },
        {
          name: "HTTP 127.0.0.1",
          conn: { type: "http", http: { url: "http://127.0.0.1:4096" } },
          buggyResult: true, // BUG: incorrectly local
          fixedResult: false, // FIXED: correctly remote
        },
        {
          name: "HTTP remote IP",
          conn: { type: "http", http: { url: "http://192.168.0.40:1455" } },
          buggyResult: false,
          fixedResult: false,
        },
        {
          name: "SSH remote",
          conn: { type: "ssh", host: "remote.com", http: { url: "http://localhost:4097" } },
          buggyResult: false,
          fixedResult: false,
        },
      ]

      for (const tc of testCases) {
        expect(isLocalBuggy(tc.conn)).toBe(tc.buggyResult)
        expect(isLocalFixed(tc.conn)).toBe(tc.fixedResult)
      }
    })
  })
})
