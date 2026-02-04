import { describe, expect, test } from "bun:test"
import { ptySocketUrl } from "./terminal-url"

describe("ptySocketUrl", () => {
  test("uses sdk host for absolute server url", () => {
    const url = ptySocketUrl("http://localhost:4096", "pty_1", "/repo", {
      host: "192.168.1.50:4096",
      protocol: "http:",
    })
    expect(url.toString()).toBe("ws://localhost:4096/pty/pty_1/connect?directory=%2Frepo")
  })

  test("does not use browser port for local dev", () => {
    const url = ptySocketUrl("http://localhost:4096", "pty_1", "/repo", {
      host: "localhost:3000",
      protocol: "http:",
    })
    expect(url.toString()).toBe("ws://localhost:4096/pty/pty_1/connect?directory=%2Frepo")
  })

  test("uses secure websocket on https", () => {
    const url = ptySocketUrl("https://opencode.local", "pty_1", "/repo", {
      host: "localhost:3000",
      protocol: "http:",
    })
    expect(url.toString()).toBe("wss://opencode.local/pty/pty_1/connect?directory=%2Frepo")
  })

  test("preserves base url port", () => {
    const url = ptySocketUrl("https://opencode.local:8443", "pty_1", "/repo", {
      host: "localhost:3000",
      protocol: "http:",
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
