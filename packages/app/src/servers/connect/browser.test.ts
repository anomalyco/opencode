import { expect, test } from "bun:test"
import { isMixedContent } from "./browser"

test.each([
  "http://server.example:4096",
  "192.168.1.20:4096",
  "http://[fd00::1]:4096",
  "http://0.0.0.0:4096",
  "http://localhost.example:4096",
  "http://127.example:4096",
])("warns about HTTP server %s on HTTPS pages", (server) => {
  expect(isMixedContent("https://beta.opencode.ai", server)).toBe(true)
  expect(isMixedContent("https://localhost:4446", server)).toBe(true)
})

test.each([
  "http://localhost:4096",
  "http://localhost.:4096",
  "http://dev.localhost:4096",
  "http://127.0.0.1:4096",
  "http://127.3.2.1:4096",
  "http://127.1:4096",
  "http://[::1]:4096",
])("allows trustworthy loopback server %s on HTTPS pages", (server) => {
  expect(isMixedContent("https://beta.opencode.ai", server)).toBe(false)
})

test("does not warn for HTTPS servers, HTTP pages, or invalid addresses", () => {
  expect(isMixedContent("https://beta.opencode.ai", "https://server.example")).toBe(false)
  expect(isMixedContent("http://localhost:4446", "http://192.168.1.20:4096")).toBe(false)
  expect(isMixedContent("http://app.example", "http://server.example")).toBe(false)
  expect(isMixedContent("https://beta.opencode.ai", "")).toBe(false)
  expect(isMixedContent("https://beta.opencode.ai", "http://")).toBe(false)
})
