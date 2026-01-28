import { test, expect } from "bun:test"
import { webSecurityDecision } from "../../src/cli/cmd/web"

test("webSecurityDecision allows loopback without password", () => {
  expect(
    webSecurityDecision({
      hostname: "127.0.0.1",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("allow")
})

test("webSecurityDecision requires confirmation for 0.0.0.0 without password in TTY", () => {
  expect(
    webSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("confirm")
})

test("webSecurityDecision denies 0.0.0.0 without password when not TTY", () => {
  expect(
    webSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: false,
    }),
  ).toBe("deny")
})

test("webSecurityDecision allows 0.0.0.0 without password when --yes is set", () => {
  expect(
    webSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: true,
      isTTY: false,
    }),
  ).toBe("allow")
})

test("webSecurityDecision allows non-loopback when password is set", () => {
  expect(
    webSecurityDecision({
      hostname: "0.0.0.0",
      passwordSet: true,
      yes: false,
      isTTY: false,
    }),
  ).toBe("allow")
})

