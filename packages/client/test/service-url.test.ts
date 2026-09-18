import { expect, test } from "bun:test"
import { loopbackURL } from "../src/service"

test("rewrites IPv4 wildcard binds to loopback", () => {
  expect(loopbackURL("http://0.0.0.0:49374")).toBe("http://127.0.0.1:49374")
  expect(loopbackURL("http://0.0.0.0")).toBe("http://127.0.0.1")
  expect(loopbackURL("http://0.0.0.0:49374/")).toBe("http://127.0.0.1:49374/")
})

test("rewrites IPv6 wildcard binds to loopback", () => {
  expect(loopbackURL("http://[::]:49374")).toBe("http://[::1]:49374")
  expect(loopbackURL("http://[::]")).toBe("http://[::1]")
})

test("leaves loopback and LAN addresses unchanged", () => {
  expect(loopbackURL("http://127.0.0.1:49374")).toBe("http://127.0.0.1:49374")
  expect(loopbackURL("http://localhost:49374/")).toBe("http://localhost:49374/")
  expect(loopbackURL("http://localhost:49374")).toBe("http://localhost:49374")
  expect(loopbackURL("http://[::1]:49374")).toBe("http://[::1]:49374")
  expect(loopbackURL("http://192.168.1.10:49374")).toBe("http://192.168.1.10:49374")
})
