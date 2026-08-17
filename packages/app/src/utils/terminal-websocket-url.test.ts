import { describe, expect, test } from "bun:test"
import { terminalWebSocketURL } from "./terminal-websocket-url"

describe("terminalWebSocketURL", () => {
  test("uses the current ticketed PTY route", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:49365",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 0,
      ticket: "connect-ticket",
    })

    expect(url.protocol).toBe("ws:")
    expect(url.username).toBe("")
    expect(url.password).toBe("")
    expect(url.pathname).toBe("/api/pty/pty_test/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/project")
    expect(url.searchParams.get("cursor")).toBe("0")
    expect(url.searchParams.get("ticket")).toBe("connect-ticket")
    expect(url.searchParams.has("auth_token")).toBe(false)
  })
})
