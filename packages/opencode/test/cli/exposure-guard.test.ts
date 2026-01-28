import { test, expect } from "bun:test"
import { exposureGuardDecision } from "../../src/cli/exposure"

test("exposureGuardDecision allows loopback without password", () => {
  expect(
    exposureGuardDecision({
      hostname: "127.0.0.1",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("allow")
})

test("exposureGuardDecision requires confirmation for 0.0.0.0 without password in TTY", () => {
  expect(
    exposureGuardDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: true,
    }),
  ).toBe("confirm")
})

test("exposureGuardDecision denies 0.0.0.0 without password when not TTY", () => {
  expect(
    exposureGuardDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: false,
      isTTY: false,
    }),
  ).toBe("deny")
})

test("exposureGuardDecision allows 0.0.0.0 without password when --yes is set", () => {
  expect(
    exposureGuardDecision({
      hostname: "0.0.0.0",
      passwordSet: false,
      yes: true,
      isTTY: false,
    }),
  ).toBe("allow")
})

test("exposureGuardDecision allows non-loopback when password is set", () => {
  expect(
    exposureGuardDecision({
      hostname: "0.0.0.0",
      passwordSet: true,
      yes: false,
      isTTY: false,
    }),
  ).toBe("allow")
})

