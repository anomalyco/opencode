import { describe, expect, test } from "bun:test"
import { ptySocketUrl } from "./terminal-url"

describe("ptySocketUrl", () => {
  test("uses browser host instead of sdk host", () => {
    const url = ptySocketUrl("http://localhost:4096", "pty_1", "/repo", {
      host: "192.168.1.50:4096",
      protocol: "http:",
    })
    expect(url.toString()).toBe("ws://192.168.1.50:4096/pty/pty_1/connect?directory=%2Frepo")
  })

  test("uses secure websocket on https", () => {
    const url = ptySocketUrl("http://localhost:4096", "pty_1", "/repo", {
      host: "opencode.local",
      protocol: "https:",
    })
    expect(url.toString()).toBe("wss://opencode.local/pty/pty_1/connect?directory=%2Frepo")
  })

  test("preserves browser port", () => {
    const url = ptySocketUrl("http://localhost:4096", "pty_1", "/repo", {
      host: "opencode.local:8443",
      protocol: "https:",
    })
    expect(url.toString()).toBe("wss://opencode.local:8443/pty/pty_1/connect?directory=%2Frepo")
  })

  test("handles slash base url", () => {
    const url = ptySocketUrl("/", "pty_1", "/repo", {
      host: "192.168.1.50:4096",
      protocol: "http:",
    })
    expect(url.toString()).toBe("ws://192.168.1.50:4096/pty/pty_1/connect?directory=%2Frepo")
  })
})
