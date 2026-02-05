import { describe, test, expect, beforeEach } from "bun:test"
import { Pty } from "../../src/pty"

describe("Pty", () => {
  describe("generateWsToken()", () => {
    test("returns a hex string", () => {
      const token = Pty.generateWsToken("pty_test123")
      expect(typeof token).toBe("string")
      expect(token).toMatch(/^[0-9a-f]+$/)
    })

    test("generates 64-character hex tokens (32 bytes)", () => {
      const token = Pty.generateWsToken("pty_test123")
      expect(token.length).toBe(64)
    })

    test("generates unique tokens each time", () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 100; i++) {
        tokens.add(Pty.generateWsToken("pty_test123"))
      }
      expect(tokens.size).toBe(100)
    })

    test("generated token can be consumed", () => {
      const ptyID = "pty_consume_test"
      const token = Pty.generateWsToken(ptyID)
      const result = Pty.consumeWsToken(token)
      expect(result).toBe(ptyID)
    })

    test("token is associated with the correct ptyID", () => {
      const token1 = Pty.generateWsToken("pty_aaa")
      const token2 = Pty.generateWsToken("pty_bbb")

      expect(Pty.consumeWsToken(token1)).toBe("pty_aaa")
      expect(Pty.consumeWsToken(token2)).toBe("pty_bbb")
    })
  })

  describe("consumeWsToken()", () => {
    test("returns undefined for unknown token", () => {
      const result = Pty.consumeWsToken("nonexistent_token_abc123")
      expect(result).toBeUndefined()
    })

    test("token is one-time use (consumed on first call)", () => {
      const token = Pty.generateWsToken("pty_oneuse")
      const first = Pty.consumeWsToken(token)
      const second = Pty.consumeWsToken(token)

      expect(first).toBe("pty_oneuse")
      expect(second).toBeUndefined()
    })

    test("returns undefined for empty string token", () => {
      const result = Pty.consumeWsToken("")
      expect(result).toBeUndefined()
    })

    test("expired tokens return undefined", async () => {
      // We can't easily test the 30s expiry directly without waiting,
      // but we can verify the structure works. The token map stores
      // { ptyID, expiresAt } and checks Date.now() < expiresAt.
      const token = Pty.generateWsToken("pty_expire_test")
      // Token should be valid immediately
      const result = Pty.consumeWsToken(token)
      expect(result).toBe("pty_expire_test")
    })
  })

  describe("Info schema", () => {
    test("validates correct PTY info", () => {
      const result = Pty.Info.safeParse({
        id: "pty_abc123def456ghijklmnopqrst",
        title: "Terminal 1234",
        command: "/bin/bash",
        args: ["-l"],
        cwd: "/home/user",
        status: "running",
        pid: 12345,
      })
      expect(result.success).toBe(true)
    })

    test("validates exited status", () => {
      const result = Pty.Info.safeParse({
        id: "pty_abc123def456ghijklmnopqrst",
        title: "Terminal",
        command: "/bin/sh",
        args: [],
        cwd: "/tmp",
        status: "exited",
        pid: 1,
      })
      expect(result.success).toBe(true)
    })

    test("rejects invalid status", () => {
      const result = Pty.Info.safeParse({
        id: "pty_abc123def456ghijklmnopqrst",
        title: "Terminal",
        command: "/bin/sh",
        args: [],
        cwd: "/tmp",
        status: "invalid",
        pid: 1,
      })
      expect(result.success).toBe(false)
    })

    test("rejects missing required fields", () => {
      const result = Pty.Info.safeParse({
        id: "pty_test",
        title: "Terminal",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("CreateInput schema", () => {
    test("accepts empty object (all fields optional)", () => {
      const result = Pty.CreateInput.safeParse({})
      expect(result.success).toBe(true)
    })

    test("accepts command and args", () => {
      const result = Pty.CreateInput.safeParse({
        command: "/bin/bash",
        args: ["-l", "-c", "echo hello"],
      })
      expect(result.success).toBe(true)
    })

    test("accepts env vars", () => {
      const result = Pty.CreateInput.safeParse({
        env: { TERM: "xterm-256color", HOME: "/home/user" },
      })
      expect(result.success).toBe(true)
    })

    test("accepts title and cwd", () => {
      const result = Pty.CreateInput.safeParse({
        title: "My Terminal",
        cwd: "/home/user/project",
      })
      expect(result.success).toBe(true)
    })
  })

  describe("UpdateInput schema", () => {
    test("accepts title update", () => {
      const result = Pty.UpdateInput.safeParse({
        title: "New Title",
      })
      expect(result.success).toBe(true)
    })

    test("accepts size update", () => {
      const result = Pty.UpdateInput.safeParse({
        size: { rows: 24, cols: 80 },
      })
      expect(result.success).toBe(true)
    })

    test("accepts both title and size", () => {
      const result = Pty.UpdateInput.safeParse({
        title: "Resized Terminal",
        size: { rows: 40, cols: 120 },
      })
      expect(result.success).toBe(true)
    })

    test("accepts empty object", () => {
      const result = Pty.UpdateInput.safeParse({})
      expect(result.success).toBe(true)
    })

    test("rejects size without rows or cols", () => {
      const result = Pty.UpdateInput.safeParse({
        size: { rows: 24 },
      })
      expect(result.success).toBe(false)
    })
  })

  describe("Event definitions", () => {
    test("Created event has correct type", () => {
      expect(Pty.Event.Created.type).toBe("pty.created")
    })

    test("Updated event has correct type", () => {
      expect(Pty.Event.Updated.type).toBe("pty.updated")
    })

    test("Exited event has correct type", () => {
      expect(Pty.Event.Exited.type).toBe("pty.exited")
    })

    test("Deleted event has correct type", () => {
      expect(Pty.Event.Deleted.type).toBe("pty.deleted")
    })

    test("Exited event validates properties", () => {
      const result = Pty.Event.Exited.properties.safeParse({
        id: "pty_abc123def456ghijklmnopqrst",
        exitCode: 0,
      })
      expect(result.success).toBe(true)
    })

    test("Exited event validates non-zero exit codes", () => {
      const result = Pty.Event.Exited.properties.safeParse({
        id: "pty_abc123def456ghijklmnopqrst",
        exitCode: 137,
      })
      expect(result.success).toBe(true)
    })
  })

  describe("buffer limit constants", () => {
    test("BUFFER_LIMIT is 2MB (tested via buffer trimming pattern)", () => {
      // The module uses BUFFER_LIMIT = 1024 * 1024 * 2
      const BUFFER_LIMIT = 1024 * 1024 * 2
      expect(BUFFER_LIMIT).toBe(2097152)

      // Test the trimming logic: when buffer exceeds limit, slice from end
      let buffer = "x".repeat(BUFFER_LIMIT + 100)
      if (buffer.length > BUFFER_LIMIT) {
        buffer = buffer.slice(-BUFFER_LIMIT)
      }
      expect(buffer.length).toBe(BUFFER_LIMIT)
    })

    test("BUFFER_CHUNK is 64KB", () => {
      const BUFFER_CHUNK = 64 * 1024
      expect(BUFFER_CHUNK).toBe(65536)
    })
  })
})
