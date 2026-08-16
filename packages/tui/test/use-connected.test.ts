import { expect, test } from "bun:test"
import { connectedForStatus, providersConnected } from "../src/component/use-connected"

test("no providers is not connected", () => {
  expect(providersConnected([])).toBe(false)
})

test("only the free opencode provider is not connected", () => {
  expect(
    providersConnected([{ id: "opencode", models: { zen: { cost: { input: 0 } } } }]),
  ).toBe(false)
})

test("a real provider is connected", () => {
  expect(
    providersConnected([{ id: "anthropic", models: { opus: { cost: { input: 15 } } } }]),
  ).toBe(true)
})

test("opencode with a paid model is connected", () => {
  expect(
    providersConnected([{ id: "opencode", models: { paid: { cost: { input: 3 } } } }]),
  ).toBe(true)
})

test("loading catalog is treated as connected to avoid a startup flash", () => {
  expect(connectedForStatus("loading", [])).toBe(true)
})

test("partial sync uses the settled empty catalog", () => {
  expect(connectedForStatus("partial", [])).toBe(false)
})

test("partial sync preserves a real provider connection", () => {
  expect(
    connectedForStatus("partial", [{ id: "anthropic", models: { opus: { cost: { input: 15 } } } }]),
  ).toBe(true)
})
