import { expect, test } from "bun:test"
import { isAllowedCorsOrigin, isAllowedRequestOrigin } from "../src/cors"

test("custom origins extend the defaults without allowing other origins", () => {
  const options = { cors: ["http://192.168.1.10:3001", "https://example.com"] }
  expect(isAllowedCorsOrigin("http://192.168.1.10:3001")).toBe(false)
  expect(isAllowedCorsOrigin("http://192.168.1.10:3001", options)).toBe(true)
  expect(isAllowedCorsOrigin("https://example.com", options)).toBe(true)
  expect(isAllowedCorsOrigin("http://localhost:3001", options)).toBe(true)
  expect(isAllowedCorsOrigin("https://app.opencode.ai", options)).toBe(true)
  expect(isAllowedCorsOrigin(undefined, options)).toBe(true)
  expect(isAllowedCorsOrigin("http://192.168.1.10:3002", options)).toBe(false)
  expect(isAllowedCorsOrigin("https://example.com.evil.test", options)).toBe(false)
  expect(isAllowedCorsOrigin("http://example.com", options)).toBe(false)
  expect(isAllowedCorsOrigin("null", options)).toBe(false)
})

test("PTY origin checks use the same allowlist and retain same-host access", () => {
  const options = { cors: ["http://192.168.1.10:3001"] }
  expect(isAllowedRequestOrigin("http://192.168.1.10:3001", "192.168.1.10:1029")).toBe(false)
  expect(isAllowedRequestOrigin("http://192.168.1.10:3001", "192.168.1.10:1029", options)).toBe(true)
  expect(isAllowedRequestOrigin("http://192.168.1.10:1029", "192.168.1.10:1029", options)).toBe(true)
  expect(isAllowedRequestOrigin("http://192.168.1.10:3002", "192.168.1.10:1029", options)).toBe(false)
})
