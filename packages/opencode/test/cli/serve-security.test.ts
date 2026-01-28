import { test, expect } from "bun:test"
import { serveSecurityDecision } from "../../src/cli/cmd/serve"

test("serveSecurityDecision allows loopback without password", () => {
  expect(
    serveSecurityDecision({
      hostname: "127.0.0.1",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("allow")
})

test("serveSecurityDecision requires confirmation for 0.0.0.0 without password in TTY", () => {
  expect(
    serveSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("confirm")
})

test("serveSecurityDecision denies 0.0.0.0 without password when not TTY", () => {
  expect(
    serveSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: false,
    }),
  ).toBe("deny")
})

test("serveSecurityDecision allows 0.0.0.0 without password when --yes is set", () => {
  expect(
    serveSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: true,
      isTTY: false,
    }),
  ).toBe("allow")
})

test("serveSecurityDecision allows non-loopback when password is set", () => {
  expect(
    serveSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: true,
      yes: false,
      isTTY: false,
    }),
  ).toBe("allow")
})

