import { test, expect } from "bun:test"
import { Provider } from "../../src/provider/provider"
import type { Config } from "../../src/config/config"

test("Provider.filter with disabled_providers only", () => {
  const config: Config.Info = {
    disabled_providers: ["anthropic", "openai"],
    enabled_providers: null,
  } as any
  const pf = Provider.filter(config)
  expect(pf.disabled.has("anthropic")).toBe(true)
  expect(pf.disabled.has("openai")).toBe(true)
  expect(pf.disabled.has("google")).toBe(false)
  expect(pf.allowed("anthropic")).toBe(false)
  expect(pf.allowed("openai")).toBe(false)
  expect(pf.allowed("google")).toBe(true)
})

test("Provider.filter with enabled_providers only", () => {
  const config: Config.Info = {
    disabled_providers: null,
    enabled_providers: ["anthropic", "openai"],
  } as any
  const pf = Provider.filter(config)
  expect(pf.disabled.has("anthropic")).toBe(false)
  expect(pf.allowed("anthropic")).toBe(true)
  expect(pf.allowed("openai")).toBe(true)
  expect(pf.allowed("google")).toBe(false)
})

test("Provider.filter with both disabled and enabled_providers", () => {
  const config: Config.Info = {
    disabled_providers: ["openai"],
    enabled_providers: ["anthropic", "openai", "google"],
  } as any
  const pf = Provider.filter(config)
  expect(pf.allowed("anthropic")).toBe(true)
  expect(pf.allowed("openai")).toBe(false)
  expect(pf.allowed("google")).toBe(true)
})

test("Provider.filter with neither disabled nor enabled_providers", () => {
  const config: Config.Info = {
    disabled_providers: null,
    enabled_providers: null,
  } as any
  const pf = Provider.filter(config)
  expect(pf.disabled.size).toBe(0)
  expect(pf.allowed("anthropic")).toBe(true)
  expect(pf.allowed("openai")).toBe(true)
  expect(pf.allowed("google")).toBe(true)
})

test("Provider.filter with empty enabled_providers array", () => {
  const config: Config.Info = {
    disabled_providers: null,
    enabled_providers: [],
  } as any
  const pf = Provider.filter(config)
  expect(pf.allowed("anthropic")).toBe(false)
  expect(pf.allowed("openai")).toBe(false)
  expect(pf.allowed("google")).toBe(false)
})

test("Provider.filter with overlapping disabled and enabled_providers", () => {
  const config: Config.Info = {
    disabled_providers: ["anthropic", "google"],
    enabled_providers: ["anthropic", "openai", "google"],
  } as any
  const pf = Provider.filter(config)
  expect(pf.allowed("anthropic")).toBe(false)
  expect(pf.allowed("openai")).toBe(true)
  expect(pf.allowed("google")).toBe(false)
})
