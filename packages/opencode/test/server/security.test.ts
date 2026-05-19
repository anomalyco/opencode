import { describe, expect, test } from "bun:test"
import { isAllowedCorsOrigin } from "../../src/server/cors"
import { isAllowedHost } from "../../src/server/host"

// These tests document and lock down the CORS allowlist that protects the
// local OpenCode HTTP/WebSocket server. The server exposes shell-execution
// endpoints, PTY upgrades, MCP install, and other privileged primitives, so
// the allowlist must reject any browser context not shipped by OpenCode.
describe("isAllowedCorsOrigin", () => {
  test("allows missing Origin (non-browser clients)", () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true)
    expect(isAllowedCorsOrigin("")).toBe(true)
  })

  test("allows the OpenCode hosted UI origins", () => {
    expect(isAllowedCorsOrigin("https://app.opencode.ai")).toBe(true)
    expect(isAllowedCorsOrigin("https://opencode.ai")).toBe(true)
  })

  test("allows packaged-app schemes (Tauri, opencode renderer)", () => {
    expect(isAllowedCorsOrigin("oc://renderer")).toBe(true)
    expect(isAllowedCorsOrigin("tauri://localhost")).toBe(true)
    expect(isAllowedCorsOrigin("http://tauri.localhost")).toBe(true)
    expect(isAllowedCorsOrigin("https://tauri.localhost")).toBe(true)
  })

  test("rejects arbitrary localhost ports (closes the cross-tab CSRF surface)", () => {
    // A previous version trusted any http://localhost:* and http://127.0.0.1:*
    // origin, which meant any other web app a user happens to have running on
    // loopback (dev tools, container UIs, etc.) could drive shell execution.
    expect(isAllowedCorsOrigin("http://localhost:3000")).toBe(false)
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(false)
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080")).toBe(false)
  })

  test("rejects subdomains of opencode.ai (no wildcard trust)", () => {
    // The previous regex `^https://([a-z0-9-]+\.)*opencode\.ai$` trusted
    // every subdomain. A subdomain takeover or XSS on a hosted experiment
    // would have implied RCE on every user's local server.
    expect(isAllowedCorsOrigin("https://attacker.opencode.ai")).toBe(false)
    expect(isAllowedCorsOrigin("https://test.staging.opencode.ai")).toBe(false)
  })

  test("rejects arbitrary external origins", () => {
    expect(isAllowedCorsOrigin("https://evil.example")).toBe(false)
    expect(isAllowedCorsOrigin("http://example.com")).toBe(false)
    expect(isAllowedCorsOrigin("null")).toBe(false)
  })

  test("honors explicit per-instance cors allowlist", () => {
    const opts = { cors: ["http://localhost:5173", "https://my.custom-ui.example"] }
    expect(isAllowedCorsOrigin("http://localhost:5173", opts)).toBe(true)
    expect(isAllowedCorsOrigin("https://my.custom-ui.example", opts)).toBe(true)
    expect(isAllowedCorsOrigin("http://localhost:9999", opts)).toBe(false)
  })

  test("does not partial-match origins", () => {
    expect(isAllowedCorsOrigin("https://app.opencode.ai.evil.example")).toBe(false)
    expect(isAllowedCorsOrigin("https://evil-app.opencode.ai")).toBe(false)
  })
})

// Host header validation defends against DNS rebinding attacks. The browser
// sends the hostname it thinks it's talking to in the Host header. If we
// don't validate that against the interfaces we're actually bound to, an
// attacker can lure the user into a page hosted at a domain that DNS-rebinds
// to 127.0.0.1 and then issue what the browser believes are same-origin
// requests to our server.
describe("isAllowedHost", () => {
  test("rejects missing Host header", () => {
    expect(isAllowedHost(undefined)).toBe(false)
    expect(isAllowedHost("")).toBe(false)
  })

  test("allows loopback names with or without port", () => {
    expect(isAllowedHost("127.0.0.1")).toBe(true)
    expect(isAllowedHost("127.0.0.1:4096")).toBe(true)
    expect(isAllowedHost("localhost")).toBe(true)
    expect(isAllowedHost("localhost:4096")).toBe(true)
    expect(isAllowedHost("[::1]")).toBe(true)
    expect(isAllowedHost("[::1]:4096")).toBe(true)
  })

  test("rejects DNS-rebound attacker hostnames", () => {
    expect(isAllowedHost("attacker.example")).toBe(false)
    expect(isAllowedHost("attacker.example:4096")).toBe(false)
    expect(isAllowedHost("not-localhost.example:4096")).toBe(false)
  })

  test("allows the configured listening hostname when not loopback or wildcard", () => {
    const opts = { hostname: "opencode.local" }
    expect(isAllowedHost("opencode.local:4096", opts)).toBe(true)
    expect(isAllowedHost("opencode.local", opts)).toBe(true)
    expect(isAllowedHost("attacker.example", opts)).toBe(false)
  })

  test("does not auto-accept the literal 0.0.0.0 wildcard", () => {
    const opts = { hostname: "0.0.0.0" }
    expect(isAllowedHost("0.0.0.0:4096", opts)).toBe(false)
    expect(isAllowedHost("attacker.example", opts)).toBe(false)
    // Loopback is still allowed under any binding.
    expect(isAllowedHost("127.0.0.1:4096", opts)).toBe(true)
  })

  test("honors mDNS domain", () => {
    const opts = { mdnsDomain: "opencode.local" }
    expect(isAllowedHost("opencode.local:4096", opts)).toBe(true)
    expect(isAllowedHost("opencode.local", opts)).toBe(true)
    expect(isAllowedHost("not-opencode.local", opts)).toBe(false)
  })

  test("honors explicit allowedHosts list", () => {
    const opts = { allowedHosts: ["my-machine.lan", "10.0.0.5"] }
    expect(isAllowedHost("my-machine.lan", opts)).toBe(true)
    expect(isAllowedHost("my-machine.lan:4096", opts)).toBe(true)
    expect(isAllowedHost("10.0.0.5:4096", opts)).toBe(true)
    expect(isAllowedHost("MY-MACHINE.LAN", opts)).toBe(true)
    expect(isAllowedHost("other-host.lan", opts)).toBe(false)
  })

  test("strips ports correctly across hostname forms", () => {
    expect(isAllowedHost("LOCALHOST:4096")).toBe(true)
    expect(isAllowedHost("  localhost:4096  ")).toBe(true)
  })
})
